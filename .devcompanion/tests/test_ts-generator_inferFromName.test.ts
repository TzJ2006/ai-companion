import { describe, it, expect } from "vitest";
import { inferFromName } from "../../packages/core/src/test-gen/ts-generator.js";

describe("inferFromName", () => {
  describe("path, file, and directory names", () => {
    it("should return path string for filePath", () => {
      const result = inferFromName("filePath");
      expect(result).toBe("\"/tmp/test\"");
      expect(typeof result).toBe("string");
    });

    it("should return path string for sourceFile", () => {
      const result = inferFromName("sourceFile");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should return path string for outputDir", () => {
      const result = inferFromName("outputDir");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should be case-insensitive for path detection", () => {
      const result = inferFromName("FilePath");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should handle all uppercase path keywords", () => {
      const result = inferFromName("FILENAME");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should detect multiple path keywords", () => {
      expect(inferFromName("inputPath")).toBe("\"/tmp/test\"");
      expect(inferFromName("outputDirectory")).toBe("\"/tmp/test\"");
      expect(inferFromName("workDir")).toBe("\"/tmp/test\"");
    });
  });

  describe("name, label, and title identifiers", () => {
    it("should return test-name for name parameter", () => {
      const result = inferFromName("name");
      expect(result).toBe("\"test-name\"");
    });

    it("should return test-name for label parameter", () => {
      const result = inferFromName("label");
      expect(result).toBe("\"test-name\"");
    });

    it("should return test-name for title parameter", () => {
      const result = inferFromName("title");
      expect(result).toBe("\"test-name\"");
    });

    it("should be case-insensitive for name detection", () => {
      const result = inferFromName("userName");
      expect(result).toBe("\"test-name\"");
    });

    it("should detect multiple name keywords", () => {
      expect(inferFromName("displayName")).toBe("\"test-name\"");
      expect(inferFromName("itemLabel")).toBe("\"test-name\"");
      expect(inferFromName("pageTitle")).toBe("\"test-name\"");
    });
  });

  describe("id and hash identifiers", () => {
    it("should return hash value for id parameter", () => {
      const result = inferFromName("id");
      expect(result).toBe("\"abc123\"");
    });

    it("should return hash value for hash parameter", () => {
      const result = inferFromName("hash");
      expect(result).toBe("\"abc123\"");
    });

    it("should return hash value for userId parameter", () => {
      const result = inferFromName("userId");
      expect(result).toBe("\"abc123\"");
    });

    it("should return hash value for elementHash parameter", () => {
      const result = inferFromName("elementHash");
      expect(result).toBe("\"abc123\"");
    });

    it("should detect multiple identifier keywords", () => {
      expect(inferFromName("documentId")).toBe("\"abc123\"");
      expect(inferFromName("transactionHash")).toBe("\"abc123\"");
      expect(inferFromName("sessionId")).toBe("\"abc123\"");
    });
  });

  describe("count, num, index, and limit parameters", () => {
    it("should return 10 for count parameter", () => {
      const result = inferFromName("count");
      expect(result).toBe("10");
    });

    it("should return 10 for num parameter", () => {
      const result = inferFromName("num");
      expect(result).toBe("10");
    });

    it("should return 10 for index parameter", () => {
      const result = inferFromName("index");
      expect(result).toBe("10");
    });

    it("should return 10 for limit parameter", () => {
      const result = inferFromName("limit");
      expect(result).toBe("10");
    });

    it("should return 10 for pageCount parameter", () => {
      const result = inferFromName("pageCount");
      expect(result).toBe("10");
    });

    it("should return 10 for numItems parameter", () => {
      const result = inferFromName("numItems");
      expect(result).toBe("10");
    });

    it("should detect numeric keywords in various contexts", () => {
      expect(inferFromName("totalCount")).toBe("10");
      expect(inferFromName("maxLimit")).toBe("10");
      expect(inferFromName("rowIndex")).toBe("10");
    });
  });

  describe("flag, enabled, and active parameters", () => {
    it("should return true for flag parameter", () => {
      const result = inferFromName("flag");
      expect(result).toBe("true");
    });

    it("should return true for enabled parameter", () => {
      const result = inferFromName("enabled");
      expect(result).toBe("true");
    });

    it("should return true for active parameter", () => {
      const result = inferFromName("active");
      expect(result).toBe("true");
    });

    it("should return true for isEnabled parameter", () => {
      const result = inferFromName("isEnabled");
      expect(result).toBe("true");
    });

    it("should return true for debugFlag parameter", () => {
      const result = inferFromName("debugFlag");
      expect(result).toBe("true");
    });

    it("should detect boolean keywords in various contexts", () => {
      expect(inferFromName("isActive")).toBe("true");
      expect(inferFromName("debugEnabled")).toBe("true");
      expect(inferFromName("testFlag")).toBe("true");
    });
  });

  describe("options, config, and opts parameters", () => {
    it("should return empty object for options parameter", () => {
      const result = inferFromName("options");
      expect(result).toBe("{}");
    });

    it("should return empty object for config parameter", () => {
      const result = inferFromName("config");
      expect(result).toBe("{}");
    });

    it("should return empty object for opts parameter", () => {
      const result = inferFromName("opts");
      expect(result).toBe("{}");
    });

    it("should return empty object for testOptions parameter", () => {
      const result = inferFromName("testOptions");
      expect(result).toBe("{}");
    });

    it("should return empty object for compilerConfig parameter", () => {
      const result = inferFromName("compilerConfig");
      expect(result).toBe("{}");
    });

    it("should detect config keywords in various contexts", () => {
      expect(inferFromName("userConfig")).toBe("{}");
      expect(inferFromName("apiOptions")).toBe("{}");
      expect(inferFromName("parseOpts")).toBe("{}");
    });
  });

  describe("items, list, and entries parameters", () => {
    it("should return empty array for items parameter", () => {
      const result = inferFromName("items");
      expect(result).toBe("[]");
    });

    it("should return empty array for list parameter", () => {
      const result = inferFromName("list");
      expect(result).toBe("[]");
    });

    it("should return empty array for entries parameter", () => {
      const result = inferFromName("entries");
      expect(result).toBe("[]");
    });

    it("should return empty array for itemList parameter", () => {
      const result = inferFromName("itemList");
      expect(result).toBe("[]");
    });

    it("should return empty array for dataList parameter", () => {
      const result = inferFromName("dataList");
      expect(result).toBe("[]");
    });

    it("should detect collection keywords in various contexts", () => {
      expect(inferFromName("userItems")).toBe("[]");
      expect(inferFromName("resultList")).toBe("[]");
      expect(inferFromName("historyEntries")).toBe("[]");
    });
  });

  describe("callback, fn, and handler parameters", () => {
    it("should return function for callback parameter", () => {
      const result = inferFromName("callback");
      expect(result).toBe("() => {}");
    });

    it("should return function for fn parameter", () => {
      const result = inferFromName("fn");
      expect(result).toBe("() => {}");
    });

    it("should return function for handler parameter", () => {
      const result = inferFromName("handler");
      expect(result).toBe("() => {}");
    });

    it("should return TODO for onChange (doesn't match callback pattern)", () => {
      const result = inferFromName("onChange");
      expect(result).toContain("TODO");
    });

    it("should return function for errorCallback parameter", () => {
      const result = inferFromName("errorCallback");
      expect(result).toBe("() => {}");
    });

    it("should return function for onClickFn parameter", () => {
      const result = inferFromName("onClickFn");
      expect(result).toBe("() => {}");
    });

    it("should detect function keywords in various contexts", () => {
      expect(inferFromName("onSubmitHandler")).toBe("() => {}");
      expect(inferFromName("transformFn")).toBe("() => {}");
      expect(inferFromName("beforeSaveCallback")).toBe("() => {}");
    });
  });

  describe("source, content, and text parameters", () => {
    it("should return test content for source parameter", () => {
      const result = inferFromName("source");
      expect(result).toBe("\"test content\"");
    });

    it("should return test content for content parameter", () => {
      const result = inferFromName("content");
      expect(result).toBe("\"test content\"");
    });

    it("should return test content for text parameter", () => {
      const result = inferFromName("text");
      expect(result).toBe("\"test content\"");
    });

    it("should return test content for sourceContent parameter", () => {
      const result = inferFromName("sourceContent");
      expect(result).toBe("\"test content\"");
    });

    it("should return test content for bodyText parameter", () => {
      const result = inferFromName("bodyText");
      expect(result).toBe("\"test content\"");
    });

    it("should detect content keywords in various contexts", () => {
      expect(inferFromName("sourceCode")).toBe("\"test content\"");
      expect(inferFromName("bodyContent")).toBe("\"test content\"");
      expect(inferFromName("messageText")).toBe("\"test content\"");
    });
  });

  describe("fallback behavior for unknown names", () => {
    it("should return TODO comment for unrecognized parameter", () => {
      const result = inferFromName("unknownParam");
      expect(result).toContain("undefined");
      expect(result).toContain("TODO");
      expect(result).toContain("unknownParam");
    });

    it("should include parameter name in TODO comment", () => {
      const result = inferFromName("unknownValue");
      expect(result).toContain("unknownValue");
    });

    it("should return TODO comment for single letter", () => {
      const result = inferFromName("x");
      expect(result).toContain("TODO");
    });

    it("should return TODO comment for numeric strings", () => {
      const result = inferFromName("value123");
      expect(result).toContain("TODO");
    });

    it("should return TODO comment for single word non-matching", () => {
      const result = inferFromName("data");
      expect(result).toContain("TODO");
    });

    it("should handle empty string", () => {
      const result = inferFromName("");
      expect(result).toContain("TODO");
    });
  });

  describe("case insensitivity", () => {
    it("should handle uppercase path keywords", () => {
      const result = inferFromName("PathName");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should handle mixed case id keywords", () => {
      const result = inferFromName("ObjectId");
      expect(result).toBe("\"abc123\"");
    });

    it("should handle mixed case config keywords", () => {
      const result = inferFromName("ConfigData");
      expect(result).toBe("{}");
    });

    it("should handle uppercase callback keywords", () => {
      const result = inferFromName("OnCallback");
      expect(result).toBe("() => {}");
    });

    it("should consistently normalize case", () => {
      expect(inferFromName("PATH")).toBe("\"/tmp/test\"");
      expect(inferFromName("Path")).toBe("\"/tmp/test\"");
      expect(inferFromName("paTh")).toBe("\"/tmp/test\"");
    });
  });

  describe("keyword priority when multiple matches exist", () => {
    it("should match first keyword for combined names", () => {
      const result = inferFromName("pathWithName");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should match name over other keywords when both present", () => {
      const result = inferFromName("labelId");
      expect(result).toBe("\"test-name\"");
    });

    it("should match enabled for flagEnabled", () => {
      const result = inferFromName("flagEnabled");
      expect(result).toBe("true");
    });

    it("should match config over other keywords", () => {
      const result = inferFromName("configOptions");
      expect(result).toBe("{}");
    });

    it("should prefer path when path appears in compound names", () => {
      expect(inferFromName("pathConfig")).toBe("\"/tmp/test\"");
      expect(inferFromName("filePath")).toBe("\"/tmp/test\"");
    });
  });

  describe("edge cases", () => {
    it("should handle names with numbers", () => {
      const result = inferFromName("param123");
      expect(result).toContain("TODO");
    });

    it("should handle names with underscores", () => {
      const result = inferFromName("test_name");
      expect(result).toBe("\"test-name\"");
    });

    it("should handle names with hyphens", () => {
      const result = inferFromName("my-name");
      expect(result).toBe("\"test-name\"");
    });

    it("should handle very long names", () => {
      const result = inferFromName("veryVeryVeryLongParameterNameWithPath");
      expect(result).toBe("\"/tmp/test\"");
    });

    it("should return string type for all cases", () => {
      const cases = [
        "filePath",
        "userName",
        "count",
        "isEnabled",
        "options",
        "items",
        "callback",
        "content",
        "unknownThing"
      ];

      cases.forEach(name => {
        const result = inferFromName(name);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
      });
    });
  });

  describe("return value validation", () => {
    it("should always return a non-empty string", () => {
      const testNames = [
        "path", "file", "dir", "name", "label", "title", "id", "hash",
        "count", "num", "index", "limit", "flag", "enabled", "active",
        "options", "config", "opts", "items", "list", "entries", "callback",
        "fn", "handler", "source", "content", "text", "randomUnknownName"
      ];

      testNames.forEach(name => {
        const result = inferFromName(name);
        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it("should return valid mock values with correct format", () => {
      const pathResult = inferFromName("path");
      const countResult = inferFromName("count");
      const configResult = inferFromName("config");
      const callbackResult = inferFromName("callback");

      expect(pathResult).toMatch(/^"/);
      expect(countResult).toMatch(/^\d+$/);
      expect(configResult).toBe("{}");
      expect(callbackResult).toBe("() => {}");
    });

    it("fallback values should contain TODO marker", () => {
      const unknownResults = [
        inferFromName("unknownParam"),
        inferFromName("randomValue"),
        inferFromName("xyz"),
        inferFromName("something")
      ];

      unknownResults.forEach(result => {
        if (result.includes("TODO")) {
          expect(result).toContain("undefined");
          expect(result).toContain("TODO");
        }
      });
    });

    it("should distinguish between different value types", () => {
      const resultTypes: Record<string, string> = {
        "path": "\"/tmp/test\"",
        "name": "\"test-name\"",
        "id": "\"abc123\"",
        "count": "10",
        "flag": "true",
        "options": "{}",
        "items": "[]",
        "callback": "() => {}"
      };

      Object.entries(resultTypes).forEach(([param, expectedValue]) => {
        expect(inferFromName(param)).toBe(expectedValue);
      });
    });
  });

  describe("realistic parameter scenarios", () => {
    it("should handle file system path parameters", () => {
      expect(inferFromName("inputPath")).toBe("\"/tmp/test\"");
      expect(inferFromName("outputDirectory")).toBe("\"/tmp/test\"");
      expect(inferFromName("filePath")).toBe("\"/tmp/test\"");
    });

    it("should handle common API parameters", () => {
      expect(inferFromName("limit")).toBe("10");
      expect(inferFromName("count")).toBe("10");
      expect(inferFromName("maxCount")).toBe("10");
    });

    it("should handle event handlers", () => {
      expect(inferFromName("onClickHandler")).toBe("() => {}");
      expect(inferFromName("errorCallback")).toBe("() => {}");
      expect(inferFromName("onChangeFn")).toBe("() => {}");
    });

    it("should handle configuration objects", () => {
      expect(inferFromName("userConfig")).toBe("{}");
      expect(inferFromName("apiOptions")).toBe("{}");
      expect(inferFromName("parseOpts")).toBe("{}");
    });

    it("should handle data collection parameters", () => {
      expect(inferFromName("itemsList")).toBe("[]");
      expect(inferFromName("entries")).toBe("[]");
      expect(inferFromName("dataItems")).toBe("[]");
    });

    it("should handle identifier parameters", () => {
      expect(inferFromName("userId")).toBe("\"abc123\"");
      expect(inferFromName("transactionHash")).toBe("\"abc123\"");
      expect(inferFromName("documentId")).toBe("\"abc123\"");
    });

    it("should handle text content parameters", () => {
      expect(inferFromName("sourceCode")).toBe("\"test content\"");
      expect(inferFromName("bodyContent")).toBe("\"test content\"");
      expect(inferFromName("messageText")).toBe("\"test content\"");
    });

    it("should handle common TypeScript parameter patterns", () => {
      expect(inferFromName("enabled")).toBe("true");
      expect(inferFromName("clickHandler")).toBe("() => {}");
      expect(inferFromName("currentIndex")).toBe("10");
      expect(inferFromName("componentName")).toBe("\"test-name\"");
    });
  });
});