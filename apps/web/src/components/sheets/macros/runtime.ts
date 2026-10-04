// The macro runtime lives in sheet-model: the browser runs it in a Web Worker, the server in an isolate (§48).
export { macroWorker, type MacroCell, type MacroEvent, type MacroOp, type MacroRequest, type MacroResult, type MacroSheetSnapshot, type MacroSnapshot } from '@workos/sheet-model';
