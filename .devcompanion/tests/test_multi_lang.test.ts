import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSupportedExtensions, initParsers, parseFileAuto } from '../../packages/ast/src/multi-lang.js';
import type { ParsedModule } from '../../packages/ast/src/types.js';

const mockParseFile = vi.fn();
const mockParseTsFile = vi.fn();
const mockInitParser = vi.fn().mockResolvedValue(undefined);
const mockInitTsParser = vi.fn().mockResolvedValue(undefined);

vi.mock('../../packages/ast/src/parser.js', () => ({
  initParser: (...args: unknown[]) => mockInitParser(...args),
  parseFile: (...args: unknown[]) => mockParseFile(...args),
}));

vi.mock('../../packages/ast/src/ts-parser.js', () => ({
  initTsParser: (...args: unknown[]) => mockInitTsParser(...args),
  parseTsFile: (...args: unknown[]) => mockParseTsFile(...args),
}));

const mockModule = (overrides: Partial<ParsedModule> = {}): ParsedModule => ({
  file_path: 'src/module.py',
  functions: [],
  classes: [],
  imports: [],
  ...overrides,
});

describe('getSupportedExtensions', () => {
  it('returns array', () => {
    const exts = getSupportedExtensions();
    expect(Array.isArray(exts)).toBe(true);
  });

  it('has Python', () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain('.py');
    expect(exts).toContain('.pyi');
  });

  it('has TypeScript', () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain('.ts');
    expect(exts).toContain('.tsx');
    expect(exts).toContain('.mts');
    expect(exts).toContain('.cts');
  });

  it('exactly 6', () => {
    const exts = getSupportedExtensions();
    expect(exts).toHaveLength(6);
  });

  it('unique', () => {
    const exts = getSupportedExtensions();
    expect(new Set(exts).size).toBe(exts.length);
  });
});

describe('initParsers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('init both', async () => {
    await initParsers();
    expect(mockInitParser).toHaveBeenCalledOnce();
    expect(mockInitTsParser).toHaveBeenCalledOnce();
  });

  it('returns undefined', async () => {
    expect(await initParsers()).toBeUndefined();
  });

  it('multi call', async () => {
    await initParsers();
    await initParsers();
    expect(mockInitParser).toHaveBeenCalledTimes(2);
  });

  it('error py', async () => {
    mockInitParser.mockRejectedValueOnce(new Error('py'));
    await expect(initParsers()).rejects.toThrow('py');
  });

  it('error ts', async () => {
    mockInitTsParser.mockRejectedValueOnce(new Error('ts'));
    await expect(initParsers()).rejects.toThrow('ts');
  });
});

describe('parseFileAuto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseFile.mockResolvedValue(mockModule());
    mockParseTsFile.mockResolvedValue(mockModule());
  });

  it('py files', async () => {
    await parseFileAuto('src/module.py');
    expect(mockParseFile).toHaveBeenCalledWith('src/module.py');
  });

  it('pyi files', async () => {
    await parseFileAuto('stubs/module.pyi');
    expect(mockParseFile).toHaveBeenCalledWith('stubs/module.pyi');
  });

  it('ts files', async () => {
    await parseFileAuto('src/index.ts');
    expect(mockParseTsFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('tsx', async () => {
    await parseFileAuto('App.tsx');
    expect(mockParseTsFile).toHaveBeenCalledWith('App.tsx');
  });

  it('mts', async () => {
    await parseFileAuto('util.mts');
    expect(mockParseTsFile).toHaveBeenCalledWith('util.mts');
  });

  it('cts', async () => {
    await parseFileAuto('config.cts');
    expect(mockParseTsFile).toHaveBeenCalledWith('config.cts');
  });

  it('uppercase', async () => {
    await parseFileAuto('MODULE.PY');
    expect(mockParseFile).toHaveBeenCalledWith('MODULE.PY');
  });

  it('error md', async () => {
    await expect(parseFileAuto('readme.md')).rejects.toThrow('Unsupported file extension: .md');
  });

  it('error js', async () => {
    await expect(parseFileAuto('index.js')).rejects.toThrow('Unsupported file extension: .js');
  });

  it('error empty', async () => {
    await expect(parseFileAuto('')).rejects.toThrow('Unsupported file extension:');
  });
});
