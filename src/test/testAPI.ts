import * as vscode from 'vscode';
import * as chai from 'chai';

/**
 * Interface to represent the state of an editor
 */
export interface EditorState {
	/**
	 * Text content of the editor
	 */
	text: string;
	/**
	 * Selections of the editor. The entries are
	 *     [line number of anchor, character number of anchor, line number of active, character number of active]
	 */
	selections: Array<[number, number, number, number]>;
}

/**
 * Parses a string to an editor state. Brackets are used to indicate selections and a less then symbol
 * after the selection end indicates that the selection is reversed.
 * Example:
 *     "This [is] an [example]<." results in the text "This is an example" and the two selections
 *     [[0, 5, 0, 7], [0, 18, 0, 11]]
 * 
 * @param string 
 * @return The editor state derived from the string
 */
export function parseEditorState(string: string): EditorState{
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

/**
 * Creates a function that waits a given time and then resolves a promise.
 * The value of the promise will be what is given as parameter to the function.
 * @param ms Number of milliseconds to wait
 */
function wait<valueType>(ms: number){
	return function(value: valueType){
		return new Promise(function(resolve: (value: valueType) => void, reject){
			setTimeout(() => {
				resolve(value);
			}, ms);
		});
	};
}

/**
 * Creates a new test file with the given editor state
 * 
 * @param initialState Editor state to initialize
 * @return Promise with the created editor.
 */
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

/**
 * Checks the state of a given editor. I.e. it checks the content and the selections.
 * 
 * @param editor Editor to check
 * @param state The state the editor should be in
 */
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

/**
 * Runs the test with the three list delimiter types: (...), [...] and {...}
 * 
 * @param initialState State the editor should start in
 * @param commands Commands to run
 * @param endState State the editor should end in
 */
export function runFileTestWithAllBrackets(
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

/**
 * Runs a test.
 * 
 * @param initialState State the editor should start in
 * @param commands Commands to run
 * @param endState State the editor should end in
 */
export function runFileTest(
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