"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_ts_1 = require("./packages/ast/src/index.ts");
async function main() {
    console.log("=== Testing AST Parser ===");
    await (0, index_ts_1.initParser)();
    const result = await (0, index_ts_1.parseFile)("/tmp/test-python-project/utils.py");
    console.log(`\nFile: ${result.file_path}`);
    console.log(`Functions: ${result.functions.length}`);
    console.log(`Classes: ${result.classes.length}`);
    for (const fn of result.functions) {
        const identity = (0, index_ts_1.computeFunctionIdentity)(result.file_path, fn);
        console.log(`\n  Function: ${fn.name}`);
        console.log(`    Params: ${fn.params.map(p => `${p.name}: ${p.type ?? 'any'}`).join(', ')}`);
        console.log(`    Return: ${fn.return_type ?? 'None'}`);
        console.log(`    Lines: ${fn.start_line}-${fn.end_line}`);
        console.log(`    Docstring: ${fn.docstring ?? '(none)'}`);
        console.log(`    Hash: ${identity.hash}`);
    }
    for (const cls of result.classes) {
        console.log(`\n  Class: ${cls.name} (${cls.bases.join(', ') || 'no bases'})`);
        for (const method of cls.methods) {
            const identity = (0, index_ts_1.computeFunctionIdentity)(result.file_path, method);
            console.log(`    Method: ${method.name}`);
            console.log(`      Params: ${method.params.map(p => `${p.name}: ${p.type ?? 'any'}`).join(', ')}`);
            console.log(`      Hash: ${identity.hash}`);
        }
    }
    console.log("\n=== AST Parser Test PASSED ===");
}
main().catch(console.error);
//# sourceMappingURL=test-run.js.map