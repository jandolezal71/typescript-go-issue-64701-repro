const ts = require('typescript');
const cfg = ts.getParsedCommandLineOfConfigFile('./tsconfig.json', {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const program = ts.createProgram(cfg.fileNames, cfg.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile('./src/repro.spec.ts');
let n = 0;
const t0 = Date.now();
(function visit(node) {
	if (ts.isExpression(node)) {
		const type = checker.getTypeAtLocation(node);
		for (const part of type.isUnion() ? type.types : [type]) {
			for (const sig of part.getCallSignatures()) { checker.getReturnTypeOfSignature(sig); n++; }
			for (const prop of part.getProperties()) {
				const pt = checker.getTypeOfSymbolAtLocation(prop, node);
				for (const sig of pt.getCallSignatures()) { checker.getReturnTypeOfSignature(sig); n++; }
			}
		}
	}
	ts.forEachChild(node, visit);
})(sf);
console.log(`tsc ${ts.version} API: ${n} return types resolved in ${Date.now() - t0} ms`);
