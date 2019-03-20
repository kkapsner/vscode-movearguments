'use strict';
import * as vscode from 'vscode';

class Argument {
	private startPosition: vscode.Position;
	private startOfContent: vscode.Position;
	private endPosition: vscode.Position;
	private endOfContent: vscode.Position;
	private document: vscode.TextDocument;
	
	private content: string;
	
	private isFirstArgument: Boolean = true;
	private isLastArgument: Boolean = true;
	
	private selectionIsReversed: Boolean;
	
	constructor(document: vscode.TextDocument, selection: vscode.Selection){
		this.selectionIsReversed = !selection.isEmpty && selection.isReversed;
		this.document = document;
		
		// find the beginning of the argument
		const startBorderRegExp = /[,({[]([^,({[]*)$/;
		function getStartPosition(startLineNumber: number, startCharacter = -1): vscode.Position{
			const line = document.lineAt(startLineNumber);
			let text = line.text;
			if (startCharacter >= 0){
				text = text.substring(0, startCharacter);
			}
			const match = startBorderRegExp.exec(text);
			if (match){
				return new vscode.Position(startLineNumber, text.length - match[1].length);
			}
			else {
				if (startLineNumber === 0){
					// no delimiter anywhere before the selection -> start of the document
					return new vscode.Position(0, 0);
				}
				else {
					// no delimiter in the current line -> search in previous line
					return getStartPosition(startLineNumber - 1);
				}
			}
		}
		this.startPosition = getStartPosition(selection.start.line, selection.start.character);
		if (this.startPosition.character !== 0){
			this.isFirstArgument = document.getText(new vscode.Range(this.startPosition.translate(undefined, -1), this.startPosition)) !== ",";
		}
		
		// find the end of the argument
		
		const endBorderRegExp = /^([^,)}\]]*)[,)}\]]/;
		const lastDocumentLine = document.lineCount - 1;
		function getEndPosition(endLineNumber: number, endCharacter = 0): vscode.Position{
			const line = document.lineAt(endLineNumber);
			let text = line.text;
			if (endCharacter > 0){
				text = text.substring(endCharacter);
			}
			const match = endBorderRegExp.exec(text);
			if (match){
				return new vscode.Position(endLineNumber, endCharacter + match[1].length);
			}
			else {
				if (endLineNumber === lastDocumentLine){
					// no delimiter anywhere before the selection -> end of the document
					return new vscode.Position(lastDocumentLine, document.lineAt(lastDocumentLine).text.length);
				}
				else {
					// no delimiter in the current line -> search in next line
					return getEndPosition(endLineNumber + 1);
				}
			}
		}
		this.endPosition = getEndPosition(selection.end.line, selection.end.character);
		
		if (
			this.endPosition.line !== lastDocumentLine ||
			this.endPosition.character !== document.lineAt(lastDocumentLine).text.length
		){
			this.isLastArgument = document.getText(new vscode.Range(this.endPosition, this.endPosition.translate(undefined, 1))) !== ",";
		}
		
		// compute actual content of the argument
		const allContent = document.getText(new vscode.Range(this.startPosition, this.endPosition));
		const startingWhitespace = /^\s*/.exec(allContent) || [""];
		const finishingWhitespace = /\s*$/.exec(allContent) || [""];
		this.content = allContent.substring(
			startingWhitespace[0].length,
			allContent.length - finishingWhitespace[0].length
		);
		
		this.startOfContent = document.positionAt(document.offsetAt(this.startPosition) + startingWhitespace[0].length);
		this.endOfContent = document.positionAt(document.offsetAt(this.endPosition) - finishingWhitespace[0].length);
	}
	
	private previousCache: Argument|null = null;
	getPreviousArgument(){
		if (!this.isFirstArgument){
			if (!this.previousCache){
				const beforeComma = this.document.positionAt(this.document.offsetAt(this.startPosition) - 1);
				this.previousCache = new Argument(this.document, new vscode.Selection(beforeComma, beforeComma));
				this.previousCache.selectionIsReversed = this.selectionIsReversed;
			}
			return this.previousCache;
		}
		else {
			return null;
		}
	}
	
	private nextCache: Argument|null = null;
	getNextArgument(){
		if (!this.isLastArgument){
			if (!this.nextCache){
				const afterComma = this.document.positionAt(this.document.offsetAt(this.endPosition) + 1);
				this.nextCache = new Argument(this.document, new vscode.Selection(afterComma, afterComma));
				this.nextCache.selectionIsReversed = this.selectionIsReversed;
			}
			return this.nextCache;
		}
		else {
			return null;
		}
	}
	
	get start(){
		return this.startOfContent;
	}
	
	get end(){
		return this.endOfContent;
	}
	
	get range(){
		return new vscode.Range(this.start, this.end);
	}
	
	get selection(){
		return this.selectionIsReversed?
			new vscode.Selection(this.end, this.start):
			new vscode.Selection(this.start, this.end);
	}
	
	getContent() {
		return this.content;
	}
	
	equals(argument: Argument){
		return this.startPosition.isEqual(argument.startPosition);
	}
	
	overlap(argument: Argument){
		return this.startPosition.isEqual(argument.startPosition) || this.endPosition.isEqual(argument.endPosition);
	}
	
	isBiggerThan(argument: Argument){
		return this.content.length > argument.content.length;
	}
}

interface ArgumentSwap {
	positionArgument: Argument;
	contentArgument: Argument;
}

class ArgumentMover {
	private swaps: ArgumentSwap[];
	constructor(){
		this.swaps = [];
	}
	move(argument: Argument, targetArgument: Argument){
		let currentSwap: null|ArgumentSwap = null;
		this.swaps.some((swap) => {
			if (swap.contentArgument.equals(argument)){
				currentSwap = swap;
				return true;
			}
			return false;
		});
		
		if (!currentSwap){
			currentSwap = {
				positionArgument: argument,
				contentArgument: argument
			};
			this.swaps.push(currentSwap);
		}
		
		let currentTargetSwap: null|ArgumentSwap = null;
		this.swaps.some((swap) => {
			if (swap.positionArgument.equals(targetArgument)){
				currentTargetSwap = swap;
				return true;
			}
			return false;
		});
		if (!currentTargetSwap){
			currentTargetSwap = {
				positionArgument: targetArgument,
				contentArgument: targetArgument
			};
			this.swaps.push(currentTargetSwap);
		}
		
		const h = currentSwap.contentArgument;
		currentSwap.contentArgument = currentTargetSwap.contentArgument;
		currentTargetSwap.contentArgument = h;
	}
	edit(edit: vscode.TextEditorEdit){
		this.swaps.forEach((swap) => {
			edit.replace(swap.positionArgument.range, swap.contentArgument.getContent());
		});
	}
}

/**
  * Returns the first the arguments in a line.
  * Example: given the the text "(a, b, c, d, e, f)" and arguments a, b, d and f are in the list
  *     of arguments to skip.
  *     If we use getNextArgument the results for the different arguments are:
  *         a: c
  *         b: c
  *         c: c
  *         d: e
  *         e: e
  *         f: null
  *      If we use getPreviousArgument the results for the different arguments are:
  *         a: null
  *         b: null
  *         c: c
  *         d: c
  *         e: e
  *         f: e
  * 
  * @param argument The argument to get the first in the line.
  * @param list The list of arguments to skip.
  * @param targetArgumentFunction The function name to use to get the target argument of the line.
  * @return The first argument in the line or null if the line ends at the border of the text.
  */
function getFirstInLine(argument: Argument, list: Argument[], targetArgumentFunction: "getPreviousArgument"|"getNextArgument"): Argument|null{
	for (let i = 0; i < list.length; i += 1){
		if (list[i].equals(argument)){
			const targetArgument = list[i][targetArgumentFunction]();
			if (targetArgument){
				return getFirstInLine(targetArgument, list, targetArgumentFunction);
			}
			else {
				return null;
			}
		}
	}
	return argument;
}

function move(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, targetArgumentFunction: "getPreviousArgument"|"getNextArgument"){
	const mover = new ArgumentMover();
	const newSelections: vscode.Selection[] = editor.selections.map((selection) => {
		return new Argument(editor.document, selection);
	}).filter((argument, index, list) => {
		for (let i = index + 1; i < list.length; i += 1){
			if (argument.overlap(list[i])){
				if (argument.isBiggerThan(list[i])){
					list[i] = argument;
				}
				return false;
			}
		}
		return true;
	}).map((argument, index, list) => {
		const targetArgument = argument[targetArgumentFunction]();
		if (targetArgument){
			const firstInLine = getFirstInLine(targetArgument, list, targetArgumentFunction);
			if (firstInLine){
				mover.move(argument, targetArgument);
				return targetArgument.selection;
			}
			else {
				return argument.selection;
			}
		}
		else {
			return argument.selection;
		}
	});
	mover.edit(edit);
	editor.selections = newSelections;
}

export function activate(context: vscode.ExtensionContext) {
	// register the move left command
	let moveLeftCommand = vscode.commands.registerTextEditorCommand(
		'movearguments.action.moveLeft',
		(editor, edit) => {
			move(editor, edit, "getPreviousArgument");
		}
	);
	context.subscriptions.push(moveLeftCommand);
	
	// register the move right command
	let moveRightCommand = vscode.commands.registerTextEditorCommand(
		'movearguments.action.moveRight',
		(editor, edit) => {
			move(editor, edit, "getNextArgument");
		}
	);
	context.subscriptions.push(moveRightCommand);
}

// this extension does not need to do anything on deactivation
// the commands are removed automatically
// export function deactivate(){}