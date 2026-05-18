import { execSync } from "node:child_process";
import type { VerificationItem } from "./ecl-parser.ts";

export interface VerificationResult {
  name: string;
  command: string;
  judgment_method: string;
  expected_outcome: string;
  actual_output: string;
  passed: boolean;
  expect?: string;
}

export function runVerification(item: VerificationItem, projectRoot: string): VerificationResult {
  const judgmentMethod = generateJudgmentMethod(item);
  const expectedOutcome = generateExpectedOutcome(item);

  try {
    const output = execSync(item.command, {
      cwd: projectRoot,
      timeout: 60000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    const passed = item.expect
      ? evaluateExpectation(output, item.expect)
      : true;

    return {
      name: item.name,
      command: item.command,
      judgment_method: judgmentMethod,
      expected_outcome: expectedOutcome,
      actual_output: output.trim().slice(0, 1000),
      passed,
      expect: item.expect,
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    const stdout = execError.stdout ?? "";
    const stderr = execError.stderr ?? "";
    const output = stdout + stderr;

    if (item.expect) {
      const passed = evaluateExpectation(output, item.expect);
      return {
        name: item.name,
        command: item.command,
        judgment_method: judgmentMethod,
        expected_outcome: expectedOutcome,
        actual_output: output.trim().slice(0, 1000),
        passed,
        expect: item.expect,
      };
    }

    return {
      name: item.name,
      command: item.command,
      judgment_method: judgmentMethod,
      expected_outcome: expectedOutcome,
      actual_output: output.trim().slice(0, 1000),
      passed: false,
      expect: item.expect,
    };
  }
}

function generateJudgmentMethod(item: VerificationItem): string {
  const command = item.command;
  const expect = item.expect?.toLowerCase() ?? "";

  if (command.includes("vitest run") || command.includes("jest") || command.includes("pytest")) {
    return "运行测试套件，全部断言通过则判定功能正确（退出码为 0 表示全部通过）";
  }

  if (command.includes("tsc --build") || command.includes("tsc --noEmit")) {
    return "运行 TypeScript 编译器进行类型检查，编译无错误则说明类型定义一致且正确";
  }

  if (command.includes("grep") || command.includes("rg")) {
    if (expect.includes("无输出") || expect.includes("no output")) {
      return "搜索不应存在的代码模式，输出为空表示没有违反约束的代码";
    }
    return "搜索特定代码模式，根据搜索结果判断代码结构是否符合预期";
  }

  if (command.includes("wc -l")) {
    if (expect.includes("≤") || expect.includes("<=")) {
      return "统计文件行数，每个文件行数不超过指定上限则符合代码规模约束";
    }
    return "统计文件行数，根据行数判断代码规模是否在合理范围内";
  }

  if (command.includes("eslint") || command.includes("lint")) {
    return "运行代码风格检查工具，无错误输出则说明代码符合编码规范";
  }

  if (expect.includes("无输出") || expect.includes("no output")) {
    return "执行检查命令，输出为空表示未检测到违规情况";
  }

  return "执行验证命令，退出码为 0 表示验证通过";
}

function generateExpectedOutcome(item: VerificationItem): string {
  if (item.expect) {
    return item.expect;
  }

  const command = item.command;

  if (command.includes("vitest run") || command.includes("jest") || command.includes("pytest")) {
    return "所有测试用例通过，无失败断言";
  }

  if (command.includes("tsc --build") || command.includes("tsc --noEmit")) {
    return "编译成功，无类型错误";
  }

  if (command.includes("grep") || command.includes("rg")) {
    return "搜索完成，结果符合预期";
  }

  return "命令执行成功（退出码为 0）";
}

function evaluateExpectation(output: string, expect: string): boolean {
  const lower = expect.toLowerCase();
  if (lower.includes("无输出") || lower.includes("no output")) {
    return output.trim() === "";
  }
  if (lower.includes("只命中") || lower.includes("only")) {
    return output.trim() === "" || output.split("\n").length <= 1;
  }
  if (lower.includes("≤") || lower.includes("<=")) {
    const numberMatch = expect.match(/(\d+)/);
    if (numberMatch) {
      const limit = parseInt(numberMatch[1], 10);
      const lines = output.trim().split("\n");
      return lines.every((line) => {
        const count = parseInt(line.trim().split(/\s+/)[0], 10);
        return isNaN(count) || count <= limit;
      });
    }
  }
  return true;
}
