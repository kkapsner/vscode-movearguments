'use strict';
import * as vscode from 'vscode';

/**
 * Representation of an argument
 */
class Argument {
	/**
	 * The start of the argument - including whitespaces at the start
	 */
	private startPosition: vscode.Position;
	/**
	 * The start of the content of the argument
	 */
	private startOfContent: vscode.Position;
	/**
	 * The end of the argument - including whitespaces at the end
	 */
	private endPosition: vscode.Position;
	/**
	 * The end of the content of the argument
	 */
	private endOfContent: vscode.Position;
	/**
	 * The document to work in
	 */
	private document: vscode.TextDocument;
	/**
	 * The original selection
	 */
	private originalSelection: vscode.Selection;
	/**
	 * The direction the argument should move
	 */
	private direction: "left"|"right"|"target";
	/**
	 * The content of the argument
	 */
	private content: string;
	/**
	 * If the argument is the first in the list
	 */
	private isFirstArgument: Boolean = true;
	/**
	 * If the argument is the last in the list
	 */
	private isLastArgument: Boolean = true;
	/**
	 * Number of delimiters in the argument
	 */
	private containedUnmatchedDelimiters: number = 0;
	/**
	 * Number of delimiters in the original selection
	 */
	private unmatchedDelimitersInOriginalSelection: number = 0;
	/**
	 * If the original selection was reversed
	 */
	private selectionIsReversed: Boolean;
	
	/**
	 * @param document The document to work in
	 * @param selection The original selection
	 */
	constructor(document: vscode.TextDocument, selection: vscode.Selection, direction: "left"|"right"|"target"){
		this.selectionIsReversed = !selection.isEmpty && selection.isReversed;
		this.document = document;
		this.originalSelection = selection;
		this.direction = direction;
		
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
		
		function getUnmatchedDelimiterCount(text: string): number{
			let count = 0;
			const match = {")": "(", "]": "[", "}": "{"};
			let stack: Array<"("|"["|"{"> = [];
			text.replace(/[(){}[\]]/g, (d) => {
				switch(d){
					case "(":
					case "[":
					case "{":
						stack.unshift(d);
						break;
					case ")":
					case "]":
					case "}":
						if (stack[0] === match[d]){
							stack.shift();
						}
						else {
							count += 1;
						}
						break;
				}
				return d;
			});
			count += stack.length;
			return count;
		}
		this.containedUnmatchedDelimiters = getUnmatchedDelimiterCount(this.content);
		this.unmatchedDelimitersInOriginalSelection = getUnmatchedDelimiterCount(document.getText(selection));
	}
	
	/**
	 * Cache for the target.
	 */
	private targetCache: Argument|null = null;
	/**
	 * The target argument after the movement
	 */
	get target(){
		if (
			!this.targetCache &&
			this.direction !== "target"
		){
			const moveLeft = this.direction === "left";
			const isAtBorder = moveLeft? this.isFirstArgument: this.isLastArgument;
			if (!isAtBorder){
				const targetPosition = (moveLeft? this.startPosition: this.endPosition).translate(undefined, moveLeft? -1: 1);
				this.targetCache = new Argument(this.document, new vscode.Selection(targetPosition, targetPosition), "target");
				this.targetCache.selectionIsReversed = this.selectionIsReversed;
			}
		}
		return this.targetCache;
	}
	
	/**
	 * If the argument is valid
	 */
	get valid(): boolean{
		return this.containedUnmatchedDelimiters <= this.unmatchedDelimitersInOriginalSelection &&
			(
				!this.target ||
				this.target.valid
			);
	}
	
	/**
	 * Start of the content of the argument
	 */
	get start(){
		return this.startOfContent;
	}
	
	/**
	 * End of the content of the argument
	 */
	get end(){
		return this.endOfContent;
	}
	
	/**
	 * Range of the content of the argument
	 */
	get range(){
		return new vscode.Range(this.startOfContent, this.endOfContent);
	}
	
	/**
	 * Selection of the content of the argument
	 */
	get selection(){
		return this.valid? (
			this.selectionIsReversed?
				new vscode.Selection(this.endOfContent, this.startOfContent):
				new vscode.Selection(this.startOfContent, this.endOfContent)
			): this.originalSelection;
	}
	
	/**
	 * @return The content of the argument
	 */
	getContent() {
		return this.content;
	}
	
	/**
	 * Checks if two arguments are the same. Only usable with non overlapping arguments.
	 * 
	 * @param argument The argument to compare against.
	 */
	equals(argument: Argument){
		return this.startPosition.isEqual(argument.startPosition);
	}
	
	/**
	 * Checks if two arguments overlap. Only usable when arguments might overlap with a common end.
	 * 
	 * @param argument The argument to check against.
	 */
	overlap(argument: Argument){
		return this.startPosition.isEqual(argument.startPosition) || this.endPosition.isEqual(argument.endPosition);
	}
	
	/**
	 * Checks if the argument is bigger as the 
	 * 
	 * @param argument The argument to compare against.
	 */
	isBiggerThan(argument: Argument){
		return this.content.length > argument.content.length;
	}
}

interface ArgumentSwap {
	positionArgument: Argument;
	contentArgument: Argument;
}

/**
 * Object to manage the argument movements.
 */
class ArgumentMover {
	private swaps: ArgumentSwap[];
	constructor(){
		this.swaps = [];
	}
	
	/**
	 * Registers a movement of a target.
	 * 
	 * @param argument The argument to move to a different spot.
	 * @param targetArgument The target position of the argument
	 */
	move(argument: Argument, targetArgument: Argument){
		let currentSwap: null|ArgumentSwap = null;
		// Is the argument already being moved by a previous call?
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
		
		// Is something else already put in the target spot?
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
		
		// Perform the actual movement
		const h = currentSwap.contentArgument;
		currentSwap.contentArgument = currentTargetSwap.contentArgument;
		currentTargetSwap.contentArgument = h;
	}
	
	/**
	 * Perform the registered movements. Do not use the object after calling this function.
	 * 
	 * @param edit The native object to do the text replacements
	 */
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
  * @return The first argument in the line or null if the line ends at the border of the text.
  */
function getFirstInLine(argument: Argument, list: Argument[]): Argument|null{
	for (let i = 0; i < list.length; i += 1){
		if (list[i].equals(argument)){
			const targetArgument = list[i].target;
			if (targetArgument){
				return getFirstInLine(targetArgument, list);
			}
			else {
				return null;
			}
		}
	}
	return argument;
}

/**
 * Core function to do the commands.
 * 
 * @param editor Native editor object provided by the API
 * @param edit Native edit object provided by the API
 * @param direction Direction the arguments should be moved
 */
function move(editor: vscode.TextEditor, edit: vscode.TextEditorEdit, direction: "left"|"right"){
	const mover = new ArgumentMover();
	const newSelections: vscode.Selection[] = editor.selections.map((selection) => {
		return new Argument(editor.document, selection, direction);
	}).filter((argument, index, list) => {
		if (!argument.valid){
			return true;
		}
		for (let i = index + 1; i < list.length; i += 1){
			if (argument.overlap(list[i])){
				// remove overlapping and duplicated arguments and keep the bigger argument
				if (argument.isBiggerThan(list[i])){
					list[i] = argument;
				}
				return false;
			}
		}
		return true;
	}).map((argument, index, list) => {
		if (!argument.valid){
			return argument.selection;
		}
		const targetArgument = argument.target;
		if (targetArgument && targetArgument.valid){
			const firstInLine = getFirstInLine(targetArgument, list);
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
			move(editor, edit, "left");
		}
	);
	context.subscriptions.push(moveLeftCommand);
	
	// register the move right command
	let moveRightCommand = vscode.commands.registerTextEditorCommand(
		'movearguments.action.moveRight',
		(editor, edit) => {
			move(editor, edit, "right");
		}
	);
	context.subscriptions.push(moveRightCommand);
}

// this extension does not need to do anything on deactivation
// the commands are removed automatically
// export function deactivate(){}