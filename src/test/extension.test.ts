import * as vscode from 'vscode';
import * as chai from 'chai';
// import * as duplicateSelection from '../extension';

interface EditorState {
	text: string;
	selections: Array<[number, number, number, number]>;
}

function parseEditorState(string: string): EditorState{
	const selections: Array<[number, number, number, number]> = [];
	var lineNumber = 0;
	var characterOffset = 0;
	const text = string.replace(/([\s\S]*?)\[([^\]]*)\](<?)/g, function(match, before: string, inside: string, reverse: string){
		const linesBefore = before.replace(/[^\n]/g, "").length;
		if (linesBefore){
			characterOffset = (/[^\n]*$/.exec(before) || [""])[0].length;
			lineNumber += linesBefore;
		}
		else {
			characterOffset += before.length;
		}
		
		const linesWithin = inside.replace(/[^\n]/g, "").length;
		let endOffset = 0;
		if (linesWithin){
			endOffset = (/[^\n]*$/.exec(inside) || [""])[0].length;
		}
		else {
			endOffset = characterOffset + inside.length;
		}
		
		if (reverse === "<"){
			selections.push([lineNumber + linesWithin, endOffset, lineNumber, characterOffset]);
		}
		else {
			selections.push([lineNumber, characterOffset, lineNumber + linesWithin, endOffset]);
		}
		characterOffset = endOffset;
		lineNumber += linesWithin;
		
		lineNumber += inside.replace(/[^\n]/g, "").length;
		return before + inside;
	});
	return {
		text,
		selections
	};
}

function wait<valueType>(ms: number){
	return function(value: valueType){
		return new Promise(function(resolve: (value: valueType) => void, reject){
			setTimeout(() => {
				resolve(value);
			}, ms);
		});
	};
}

function initializeEditor(initialState: EditorState){
	return vscode.commands.executeCommand("workbench.action.files.newUntitledFile")
		.then(wait(0))
		.then((): vscode.TextEditor => {
			var editor = vscode.window.activeTextEditor;
			chai.expect(editor).not.to.be.equal(undefined, "No editor found.");
			return editor as vscode.TextEditor;
		}).then((editor: vscode.TextEditor) => {
			return editor.edit((edit) => {
				edit.insert(new vscode.Position(0, 0), initialState.text);
			}).then(() => {
				editor.selections = initialState.selections.map(function(selection){
					return new vscode.Selection(
						new vscode.Position(selection[0], selection[1]),
						new vscode.Position(selection[2], selection[3])
					);
				});
				return editor;
			});
		});
}

function confirmEditorState(editor: vscode.TextEditor, state: EditorState){
	chai.expect(editor.document.getText()).to.be.equal(state.text, "Document contains wrong text.");
	chai.expect(editor.selections.length).to.be.equal(state.selections.length, "Wrong number of selections.");
	state.selections.forEach(function(selection, index){
		var editorSelection = editor.selections[index];
		chai.expect([
			editorSelection.anchor.line,
			editorSelection.anchor.character,
			editorSelection.active.line,
			editorSelection.active.character,
		]).to.deep.equal(selection, `Wrong selection ${index}`);
	});
	return true;
}

function runFileTestWithAllBrackets(
	initialState: EditorState,
	commands: Array<string | ((editor: vscode.TextEditor) => undefined)>,
	endState: EditorState
){
	return runFileTest(initialState, commands, endState).then((success) => {
		if (success && initialState.text.length < 200){
			initialState.text = initialState.text.replace(/\(/g, "{").replace(/\)/g, "}");
			endState.text = endState.text.replace(/\(/g, "{").replace(/\)/g, "}");
			return runFileTest(initialState, commands, endState).then((success) => {
				if (success){
					initialState.text = initialState.text.replace(/\{/g, "[").replace(/\}/g, "]");
					endState.text = endState.text.replace(/\{/g, "[").replace(/\}/g, "]");
					return runFileTest(initialState, commands, endState);
				}
				else {
					return success;
				}
			});
		}
		else {
			return success;
		}
	});
}
function runFileTest(
	initialState: EditorState,
	commands: Array<string | ((editor: vscode.TextEditor) => undefined)>,
	endState: EditorState
){
	return initializeEditor(initialState)
		.then(wait(0))
		.then((editor) => {
			commands.forEach(function(command){
				if (typeof command === "string"){
					const start = Date.now();
					vscode.commands.executeCommand(command);
					console.log("Command time ", Date.now() - start, "ms");
				}
				else {
					command(editor);
				}
			});
			return editor;
		})
		.then(wait(200))
		.then((editor) => {return confirmEditorState(editor, endState);});
}

suite("movearguments tests", function(){
	test(
		"Move an argument right",
		() => {
			const initialState: EditorState = parseEditorState(`function([]a, bb, ccc)`);
			const endState: EditorState = parseEditorState(`function(bb, [a], ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move an argument left",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []bb, ccc)`);
			const endState: EditorState = parseEditorState(`function([bb], a, ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move an argument right - different selections",
		() => {
			const initialStates = [
				parseEditorState(`function(a,[] bb, ccc)`),
				parseEditorState(`function(a, []bb, ccc)`),
				parseEditorState(`function(a, b[]b, ccc)`),
				parseEditorState(`function(a, bb[], ccc)`),
			];
			const endState: EditorState = parseEditorState(`function(a, ccc, [bb])`);
			let index = 0;
			function run(success: boolean): boolean|Thenable<boolean>{
				if (!success || index === initialStates.length){
					return success;
				}
				const initialState = initialStates[index];
				index += 1;
				return runFileTest(initialState, ["movearguments.action.moveRight"], endState).then(run);
			}
			return run(true);
		}
	);
	test(
		"Move an argument right - different selections 2",
		() => {
			const initialStates = [
				parseEditorState(`function(a,[ bb], ccc)`),
				parseEditorState(`function(a,[ b]b, ccc)`),
				parseEditorState(`function(a,[] bb[], ccc)`),
				parseEditorState(`function(a,[ b][b], ccc)`),
			];
			const endState: EditorState = parseEditorState(`function(a, ccc, [bb])`);
			let index = 0;
			function run(success: boolean): boolean|Thenable<boolean>{
				if (!success || index === initialStates.length){
					return success;
				}
				const initialState = initialStates[index];
				index += 1;
				return runFileTest(initialState, ["movearguments.action.moveRight"], endState).then(run);
			}
			return run(true);
		}
	);
	test(
		"Move an argument right - but only one argument",
		() => {
			const initialState: EditorState = parseEditorState("function([]a)");
			const endState: EditorState = parseEditorState("function([a])");
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move an argument left - but only one argument",
		() => {
			const initialState: EditorState = parseEditorState("function([]a)");
			const endState: EditorState = parseEditorState("function([a])");
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move an argument right - but last argument",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, bb, c[]cc )`);
			const endState: EditorState = parseEditorState(`function(a, bb, [ccc] )`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move an argument left - but first argument",
		() => {
			const initialState: EditorState = parseEditorState(`function( []a, bb, ccc)`);
			const endState: EditorState = parseEditorState(`function( [a], bb, ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move an argument right - end of file",
		() => {
			const initialState: EditorState = parseEditorState(`function(a,
				bb,
				c[]cc,
				dddd
				 `);
			const endState: EditorState = parseEditorState(`function(a,
				bb,
				dddd,
				[ccc]
				 `);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move an argument left - start of file",
		() => {
			const initialState: EditorState = parseEditorState(` 
				a,
				[]bb,
				ccc
			)`);
			const endState: EditorState = parseEditorState(` 
				[bb],
				a,
				ccc
			)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move an argument right - but end of file",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, bb, c[]cc `);
			const endState: EditorState = parseEditorState(`function(a, bb, [ccc] `);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move an argument left - but start of file",
		() => {
			const initialState: EditorState = parseEditorState(`[]a, bb, ccc)`);
			const endState: EditorState = parseEditorState(`[a], bb, ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move two arguments right",
		() => {
			const initialState: EditorState = parseEditorState(`function(a[, b]b, ccc)`);
			const endState: EditorState = parseEditorState(`function(ccc, [a, bb])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move two arguments left",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, b[b, c]cc)`);
			const endState: EditorState = parseEditorState(`function([bb, ccc], a)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move multi line argument right",
		() => {
			const initialState: EditorState = parseEditorState(`function(
					a
					with[]
					line break
					,
					b, c
				)`);
			const endState: EditorState = parseEditorState(`function(
					b
					,
					[a
					with
					line break], c
				)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move multi line argument left",
		() => {
			const initialState: EditorState = parseEditorState(`function(
					a, b
					wi[th
					line ]break, c
				)`);
			const endState: EditorState = parseEditorState(`function(
					[b
					with
					line break], a, c
				)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move two selections right",
		() => {
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , ccc, d[d], eee, f)`);
			const endState: EditorState = parseEditorState(`function(a, ccc , [bb], eee, [dd], f)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move two selections left",
		() => {
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , ccc, d[d], eee, f)`);
			const endState: EditorState = parseEditorState(`function([bb], a , [dd], ccc, eee, f)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move two selections right - same argument",
		() => {
			const initialState: EditorState = parseEditorState(`function([]a[], bb, ccc)`);
			const endState: EditorState = parseEditorState(`function(bb, [a], ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move two selections left - same argument",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b[]b, ccc)`);
			const endState: EditorState = parseEditorState(`function([bb], a, ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move two selections right - same but last argument",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, bb, c[]c[]c)`);
			const endState: EditorState = parseEditorState(`function(a, bb, [ccc])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move two selections left - same but fist argument",
		() => {
			const initialState: EditorState = parseEditorState(`function([]a[], bb, ccc)`);
			const endState: EditorState = parseEditorState(`function([a], bb, ccc)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move adjacent selections right",
		() => {
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , cc[]c, []dd,[ eee], f)`);
			const endState: EditorState = parseEditorState(`function(a, f , [bb], [ccc], [dd], [eee])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move adjacent selections left",
		() => {
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , cc[]c, d[]d,[ e]ee, f)`);
			const endState: EditorState = parseEditorState(`function([bb], [ccc] , [dd], [eee], a, f)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move adjacent selections right - mixed order",
		() => {
			function mixOrder(state: EditorState){
				state.selections = [2, 0, 1, 3].map((index) => {return state.selections[index];});
			}
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , cc[]c, []dd,[ eee], f)`);
			mixOrder(initialState);
			const endState: EditorState = parseEditorState(`function(a, f , [bb], [ccc], [dd], [eee])`);
			mixOrder(endState);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move adjacent selections left - mixed order",
		() => {
			function mixOrder(state: EditorState){
				state.selections = [2, 0, 1, 3].map((index) => {return state.selections[index];});
			}
			const initialState: EditorState = parseEditorState(`function(a,[ b]b , cc[]c, d[]d,[ e]ee, f)`);
			mixOrder(initialState);
			const endState: EditorState = parseEditorState(`function([bb], [ccc] , [dd], [eee], a, f)`);
			mixOrder(endState);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move overlapping selections right 1",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, b[,] [c], d)`);
			const endState: EditorState = parseEditorState(`function(a, d, [b, c])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move overlapping selections left 1",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, b[,] [c], d)`);
			const endState: EditorState = parseEditorState(`function([b, c], a, d)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move overlapping selections right 2",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b[, ]c, d)`);
			const endState: EditorState = parseEditorState(`function(a, d, [b, c])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move overlapping selections left 2",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b[, ]c, d)`);
			const endState: EditorState = parseEditorState(`function([b, c], a, d)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Move overlapping selections right 3",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b[,] c[], d)`);
			const endState: EditorState = parseEditorState(`function(a, d, [b, c])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Move overlapping selections left 3",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b[,] c[], d)`);
			const endState: EditorState = parseEditorState(`function([b, c], a, d)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Multiple selections move right but no space",
		() => {
			const initialState: EditorState = parseEditorState(`function(a[], b, c[], [d])`);
			const endState: EditorState = parseEditorState(`function(b, [a], [c], [d])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Multiple selections move left but no space",
		() => {
			const initialState: EditorState = parseEditorState(`function(a[], []b, c, [d])`);
			const endState: EditorState = parseEditorState(`function([a], [b], [d], c)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Multiple selections move right - mixed directions",
		() => {
			const initialState: EditorState = parseEditorState(`function([a]<, b, c[], d)`);
			const endState: EditorState = parseEditorState(`function(b, [a]<, d, [c])`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveRight"], endState);
		}
	);
	test(
		"Multiple selections move left - mixed directions",
		() => {
			const initialState: EditorState = parseEditorState(`function(a, []b,[ ]<c, d)`);
			const endState: EditorState = parseEditorState(`function([b], [c]<, a, d)`);
			return runFileTestWithAllBrackets(initialState, ["movearguments.action.moveLeft"], endState);
		}
	);
	test(
		"Big file",
		() => {
			const padding = ("a".repeat(50) + "\n").repeat(1e3);
			const initialState: EditorState = parseEditorState(`${padding}function(a, ${"a\n".repeat(10)}[]b${"\na".repeat(10)}, c)${padding}`);
			const endState: EditorState = parseEditorState(`${padding}function([${"a\n".repeat(10)}b${"\na".repeat(10)}], a, c)${padding}`);
			return runFileTest(initialState, ["movearguments.action.moveLeft"], endState);
		}
	).timeout(10000);
});