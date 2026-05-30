// 测试 — GrepController grep 函数改动验证
// 覆盖：escapeRegex、parseDirs、buildFindCommand、ctags/rg/perl 三级路径、定义 vs 调用区分
import { strict as assert } from 'assert';

// ============================================================
// 复用 GrepController 中的关键逻辑（避免引入 vscode 依赖）
// ============================================================

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ParsedDirs {
  includes: string[];
  excludes: string[];
}

function parseDirs(raw: string): ParsedDirs {
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let part of raw.split(';')) {
    part = part.trim();
    if (part.length === 0) { continue; }
    if (part.startsWith('!')) {
      const ex = part.slice(1).trim();
      if (ex.length > 0) { excludes.push(ex); }
    } else {
      includes.push(part);
    }
  }
  return { includes, excludes };
}

/**
 * 构建 find 命令（跟随符号链接、排除目录）
 * 返回以 | 结尾的命令片段
 */
function buildFindCommand(
  searchPaths: string[],
  excludes: string[],
  followSymlinks: boolean = true
): string {
  const L = followSymlinks ? '-L ' : '';
  const paths = searchPaths.length > 0
    ? searchPaths.map(d => JSON.stringify(d))
    : [JSON.stringify('.')];

  if (excludes.length > 0) {
    const varDefs = excludes.map((d, i) => `_ex${i}=${d}`).join('; ');
    const excludeFlags = excludes.map((_, i) =>
      ` -not -path "*/\${_ex${i}##*/}/*"`
    ).join('');
    return `${varDefs}; find ${L}${paths.join(' ')} -type f ${excludeFlags} | sort |`;
  }
  return `find ${L}${paths.join(' ')} -type f | sort |`;
}

function buildGrepKeywordCommand(pattern: string, includes: string[], excludes: string[]): string {
  const searchPaths = includes.length > 0
    ? includes.map(d => JSON.stringify(d))
    : [JSON.stringify('.')];

  let prefix = '';
  let excludeFlags = '';
  if (excludes.length > 0) {
    excludeFlags = excludes.map((d, i) => {
      prefix += `_ex${i}=${d}; `;
      return `--exclude-dir="\\${'_ex' + i + '##*/'}"`;
    }).join(' ');
  }

  const safePattern = pattern.replace(/'/g, "'\\''");
  const sep = '>>>';
  return `${prefix}echo "${sep}" && grep -Rn --color=always ${excludeFlags} '${safePattern}' ${searchPaths.join(' ')} && echo "${sep}"`;
}

/** 旧版 perl flip-flop（保留用于回归对比） */
function buildGrepFunctionCommandOld(keyword: string, includes: string[], excludes: string[]): string {
  const searchPaths = includes.length > 0
    ? includes.map(d => JSON.stringify(d))
    : [JSON.stringify('.')];

  let excludeScript = '';
  if (excludes.length > 0) {
    const varDefs = excludes.map((d, i) => `_ex${i}=${d}`).join('; ');
    const excludeFlags = excludes.map((_, i) =>
      ` -not -path "*/\\${'_ex' + i + '##*/'}/*"`
    ).join('');
    excludeScript = `${varDefs}; `;
    excludeScript += `find ${searchPaths.join(' ')} -type f ${excludeFlags} | sort |`;
  } else {
    excludeScript = `find ${searchPaths.join(' ')} -type f | sort |`;
  }

  const escaped = escapeRegex(keyword);
  const sep = '>>>';
  const perlExpr = `/\\b${escaped}\\s*\\(/ .. /\\)/`;
  return `echo "${sep}" && ${excludeScript} xargs perl -ne 'if (${perlExpr}) { print "\\$ARGV:\\$.:\\$_" }' && echo "${sep}"`;
}

/**
 * 路径 A — ctags 命令
 */
function buildGrepFunctionCtagsCommand(keyword: string, includes: string[], excludes: string[]): string {
  const findCmd = buildFindCommand(includes, excludes, true);
  const sep = '>>>';
  const safeKw = keyword.replace(/"/g, '\\"');
  return [
    `echo "${sep}"`,
    `&&`,
    `${findCmd} xargs ctags -x --c-kinds=f --language-force=C++ --sort=no 2>/dev/null`,
    `|`,
    `awk -v kw="${safeKw}" '$1==kw {printf "\\033[1;31m%s\\033[0m:%s: %s\\n", $2, $3, $0}'`,
    `&&`,
    `echo "${sep}"`,
  ].join(' ');
}

/**
 * 路径 B — ripgrep 命令
 */
function buildGrepFunctionRgCommand(keyword: string, includes: string[], excludes: string[]): string {
  const findCmd = buildFindCommand(includes, excludes, true);
  const sep = '>>>';
  const escaped = escapeRegex(keyword);
  const safeKw = escaped.replace(/'/g, "'\\''");
  return [
    `echo "${sep}"`,
    `&&`,
    `${findCmd} xargs rg -n --color=always --no-heading -U`,
    `'\\b${safeKw}\\s*\\([\\s\\S]*?\\)\\s*\\{'`,
    `&&`,
    `echo "${sep}"`,
  ].join(' ');
}

/**
 * 路径 C — 改进版 perl（括号深度计数 + ) { 判断定义）
 */
function buildGrepFunctionPerlCommand(keyword: string, includes: string[], excludes: string[]): string {
  const findCmd = buildFindCommand(includes, excludes, true);
  const sep = '>>>';
  const escaped = escapeRegex(keyword);
  const safeKw = escaped.replace(/'/g, "'\\''");

  const perlCode = [
    `if (\\$check_next) {`,
    `  if (/^\\s*\\{/) { printf "\\033[1;31m%s\\033[0m", \\$buf; }`,
    `  \\$check_next=0; \\$buf="";`,
    `}`,
    `if (!\\$in && /\\b${safeKw}\\s*\\(/) {`,
    `  \\$in=1; \\$depth=0; \\$buf="";`,
    `}`,
    `if (\\$in) {`,
    `  \\$depth += tr/(/(/ - tr/)/)/;`,
    `  \\$buf .= "\\$ARGV:\\$.:\\$_";`,
    `  if (\\$depth <= 0) {`,
    `    if (/\\{\\s*\\$/) { printf "\\033[1;31m%s\\033[0m", \\$buf; }`,
    `    else { \\$check_next=1; }`,
    `    \\$in=0;`,
    `  }`,
    `}`,
  ].join(' ');

  return [
    `echo "${sep}"`,
    `&&`,
    `${findCmd} xargs perl -ne '${perlCode}'`,
    `&&`,
    `echo "${sep}"`,
  ].join(' ');
}

// ============================================================
// Test cases
// ============================================================

describe('GrepController — escapeRegex', () => {
  it('plain strings unchanged', () => {
    assert.strictEqual(escapeRegex('hello'), 'hello');
    assert.strictEqual(escapeRegex('FooBar'), 'FooBar');
  });

  it('escapes regex special chars', () => {
    assert.strictEqual(escapeRegex('foo('), 'foo\\(');
    assert.strictEqual(escapeRegex('foo.bar'), 'foo\\.bar');
    assert.strictEqual(escapeRegex('foo*'), 'foo\\*');
    assert.strictEqual(escapeRegex('foo+bar'), 'foo\\+bar');
    assert.strictEqual(escapeRegex('foo?bar'), 'foo\\?bar');
    assert.strictEqual(escapeRegex('foo^bar'), 'foo\\^bar');
    assert.strictEqual(escapeRegex('foo$bar'), 'foo\\$bar');
    assert.strictEqual(escapeRegex('foo{2}'), 'foo\\{2\\}');
    assert.strictEqual(escapeRegex('foo|bar'), 'foo\\|bar');
    assert.strictEqual(escapeRegex('foo[bar]'), 'foo\\[bar\\]');
    assert.strictEqual(escapeRegex('foo\\bar'), 'foo\\\\bar');
  });

  it('C++ style :: unchanged', () => {
    assert.strictEqual(escapeRegex('MyClass::myFunc'), 'MyClass::myFunc');
  });

  it('template args <> unchanged', () => {
    assert.strictEqual(escapeRegex('func<T>'), 'func<T>');
  });
});

describe('GrepController — parseDirs', () => {
  it('empty string', () => {
    const r = parseDirs('');
    assert.deepStrictEqual(r.includes, []);
    assert.deepStrictEqual(r.excludes, []);
  });

  it('single include', () => {
    const r = parseDirs('src/');
    assert.deepStrictEqual(r.includes, ['src/']);
    assert.deepStrictEqual(r.excludes, []);
  });

  it('multiple includes separated by ;', () => {
    const r = parseDirs('src/; lib/; test/');
    assert.deepStrictEqual(r.includes, ['src/', 'lib/', 'test/']);
  });

  it('single exclude with !', () => {
    const r = parseDirs('!node_modules');
    assert.deepStrictEqual(r.includes, []);
    assert.deepStrictEqual(r.excludes, ['node_modules']);
  });

  it('mixed include and exclude', () => {
    const r = parseDirs('src/; !test; !node_modules');
    assert.deepStrictEqual(r.includes, ['src/']);
    assert.deepStrictEqual(r.excludes, ['test', 'node_modules']);
  });

  it('trims whitespace', () => {
    const r = parseDirs(' src/ ; ! test ; lib/ ');
    assert.deepStrictEqual(r.includes, ['src/', 'lib/']);
    assert.deepStrictEqual(r.excludes, ['test']);
  });

  it('empty split parts ignored', () => {
    const r = parseDirs('src/;;;lib/');
    assert.deepStrictEqual(r.includes, ['src/', 'lib/']);
  });

  it('! with empty content ignored', () => {
    const r = parseDirs('!; src/');
    assert.deepStrictEqual(r.includes, ['src/']);
    assert.deepStrictEqual(r.excludes, []);
  });
});

// ================================================================
//  buildFindCommand — 新抽取的共用工具
// ================================================================
describe('GrepController — buildFindCommand', () => {
  it('no includes/excludes → default "." with -L', () => {
    const cmd = buildFindCommand([], []);
    assert.ok(cmd.startsWith('find -L "." -type f | sort |'));
  });

  it('followSymlinks=false omits -L', () => {
    const cmd = buildFindCommand([], [], false);
    assert.ok(cmd.startsWith('find "." -type f | sort |'));
    assert.ok(!cmd.includes('-L'));
  });

  it('with include dirs', () => {
    const cmd = buildFindCommand(['src/'], []);
    assert.ok(cmd.includes('"src/"'));
    assert.ok(!cmd.includes('"."'));
    assert.ok(cmd.includes('-L'));
  });

  it('with exclude dirs', () => {
    const cmd = buildFindCommand([], ['node_modules', 'build']);
    assert.ok(cmd.includes('_ex0=node_modules'));
    assert.ok(cmd.includes('_ex1=build'));
    assert.ok(cmd.includes('-not -path'));
    // shell 取 basename 排除
    assert.ok(cmd.includes('_ex0##*/'));
    assert.ok(cmd.includes('_ex1##*/'));
  });

  it('paths with spaces are quoted', () => {
    const cmd = buildFindCommand(['my path/'], []);
    assert.ok(cmd.includes('"my path/"'));
  });

  it('returns command ending with | for piping', () => {
    const cmd = buildFindCommand([], []);
    assert.ok(cmd.endsWith('|'));
  });
});

describe('GrepController — grepKeyword command generation', () => {
  it('basic: no includes/excludes', () => {
    const cmd = buildGrepKeywordCommand('ERROR', [], []);
    assert.ok(cmd.includes('grep -Rn --color=always'));
    assert.ok(cmd.includes("'ERROR'"));
    assert.ok(cmd.includes('"."'));
    assert.ok(cmd.includes('>>>'));
  });

  it('with include dirs', () => {
    const cmd = buildGrepKeywordCommand('ERROR', ['src/'], []);
    assert.ok(cmd.includes('"src/"'));
    assert.ok(!cmd.includes('"."'));
  });

  it('exclude uses --exclude-dir with basename', () => {
    const cmd = buildGrepKeywordCommand('ERROR', [], ['node_modules', 'build']);
    assert.ok(cmd.includes('_ex0=node_modules'));
    assert.ok(cmd.includes('_ex1=build'));
    assert.ok(cmd.includes('--exclude-dir='));
  });

  it('safe single-quote escaping', () => {
    const cmd = buildGrepKeywordCommand("it's", [], []);
    assert.ok(cmd.includes("'it'\\''s'"));
  });
});

// ================================================================
//  路径 A — ctags 命令生成测试
// ================================================================
describe('GrepController — ctags path (runGrepFunctionCtags)', () => {
  it('basic: no includes/excludes', () => {
    const cmd = buildGrepFunctionCtagsCommand('process', [], []);
    assert.ok(cmd.includes('ctags -x --c-kinds=f --language-force=C++ --sort=no'));
    assert.ok(cmd.includes('2>/dev/null'));
    assert.ok(cmd.includes('awk -v kw="process"'));
    assert.ok(cmd.includes('>>>'));
  });

  it('with include dirs', () => {
    const cmd = buildGrepFunctionCtagsCommand('foo', ['src/'], []);
    assert.ok(cmd.includes('"src/"'));
    assert.ok(!cmd.includes('"."'));
  });

  it('exclude uses find -not -path with basename', () => {
    const cmd = buildGrepFunctionCtagsCommand('foo', ['src/'], ['test', 'build']);
    assert.ok(cmd.includes('_ex0=test'));
    assert.ok(cmd.includes('_ex1=build'));
    assert.ok(cmd.includes('-not -path'));
  });

  it('find follows symlinks (-L)', () => {
    const cmd = buildGrepFunctionCtagsCommand('foo', [], []);
    assert.ok(cmd.includes('find -L'));
  });

  it('awk filters by exact function name ($1==kw)', () => {
    const cmd = buildGrepFunctionCtagsCommand('myFunc', [], []);
    // awk compares $1 (function name) exactly against keyword
    assert.ok(cmd.includes("$1==kw"));
  });

  it('ANSI color codes present in awk printf', () => {
    const cmd = buildGrepFunctionCtagsCommand('test', [], []);
    assert.ok(cmd.includes('\\033[1;31m'));
    assert.ok(cmd.includes('\\033[0m'));
  });

  it('keyword with double-quote is escaped for awk', () => {
    const cmd = buildGrepFunctionCtagsCommand('foo"bar', [], []);
    assert.ok(cmd.includes('kw="foo\\"bar"'));
  });

  it('command starts and ends with >>> separators', () => {
    const cmd = buildGrepFunctionCtagsCommand('x', [], []);
    assert.ok(cmd.startsWith('echo ">>>"'));
    assert.ok(cmd.endsWith('echo ">>>"'));
  });
});

// ================================================================
//  路径 B — ripgrep 命令生成测试
// ================================================================
describe('GrepController — rg path (runGrepFunctionRg)', () => {
  it('basic: no includes/excludes', () => {
    const cmd = buildGrepFunctionRgCommand('process', [], []);
    assert.ok(cmd.includes('rg -n --color=always --no-heading -U'));
    assert.ok(cmd.includes('>>>'));
  });

  it('uses -U (--multiline) for cross-line matching', () => {
    const cmd = buildGrepFunctionRgCommand('foo', [], []);
    assert.ok(cmd.includes(' -U '));
  });

  it('regex pattern includes word boundary and brace detection', () => {
    const cmd = buildGrepFunctionRgCommand('foo', [], []);
    // pattern: \bkeyword\s*\([\s\S]*?\)\s*\{
    assert.ok(cmd.includes('\\s*\\('));
    assert.ok(cmd.includes('[\\s\\S]*?'));
    assert.ok(cmd.includes('\\s*\\{'));
  });

  it('with include dirs via find', () => {
    const cmd = buildGrepFunctionRgCommand('foo', ['src/'], []);
    assert.ok(cmd.includes('"src/"'));
  });

  it('find follows symlinks (-L)', () => {
    const cmd = buildGrepFunctionRgCommand('foo', [], []);
    assert.ok(cmd.includes('find -L'));
  });

  it('special chars in keyword are escaped', () => {
    const cmd = buildGrepFunctionRgCommand('operator()', [], []);
    assert.ok(cmd.includes('operator\\(\\)'));
  });

  it('keyword with single quote is escaped for bash', () => {
    const cmd = buildGrepFunctionRgCommand("it's", [], []);
    assert.ok(cmd.includes("'\\''"));
  });

  it('command starts and ends with >>> separators', () => {
    const cmd = buildGrepFunctionRgCommand('x', [], []);
    assert.ok(cmd.startsWith('echo ">>>"'));
    assert.ok(cmd.endsWith('echo ">>>"'));
  });
});

// ================================================================
//  路径 C — 改进版 perl 命令生成测试
// ================================================================
describe('GrepController — perl path (runGrepFunctionPerl)', () => {
  it('basic: no includes/excludes', () => {
    const cmd = buildGrepFunctionPerlCommand('process', [], []);
    assert.ok(cmd.includes('xargs perl -ne'));
    assert.ok(cmd.includes('>>>'));
  });

  it('uses paren depth counting (tr///)', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', [], []);
    assert.ok(cmd.includes('tr/(/(/'));
    assert.ok(cmd.includes('tr/)/)/'));
    assert.ok(cmd.includes('$depth'));
  });

  it('checks for { after ) closes to distinguish definition', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', [], []);
    // check_next state variable
    assert.ok(cmd.includes('$check_next'));
    // checks for { after ) closes
    assert.ok(cmd.includes('/^\\s*\\{/'));
  });

  it('buffers output and prints only when definition confirmed', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', [], []);
    assert.ok(cmd.includes('$buf'));
    assert.ok(cmd.includes('printf'));
  });

  it('ANSI red color in output', () => {
    const cmd = buildGrepFunctionPerlCommand('test', [], []);
    assert.ok(cmd.includes('\\033[1;31m'));
    assert.ok(cmd.includes('\\033[0m'));
  });

  it('detects keyword( as definition start', () => {
    const cmd = buildGrepFunctionPerlCommand('myFunc', [], []);
    // perl regex: /\bmyFunc\s*\(/
    assert.ok(cmd.includes('/\\bmyFunc\\s*\\('));
  });

  it('find follows symlinks (-L)', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', [], []);
    assert.ok(cmd.includes('find -L'));
  });

  it('exclude uses find -not -path', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', ['src/'], ['test', 'build']);
    assert.ok(cmd.includes('-not -path'));
  });

  it('perl $ARGV $. $_ variables preserved', () => {
    const cmd = buildGrepFunctionPerlCommand('foo', [], []);
    assert.ok(cmd.includes('$ARGV'));
    assert.ok(cmd.includes('$.'));
    assert.ok(cmd.includes('$_'));
  });

  it('keyword with special chars is escaped', () => {
    const cmd = buildGrepFunctionPerlCommand('foo+bar', [], []);
    assert.ok(cmd.includes('foo\\+bar'));
  });

  it('command starts and ends with >>> separators', () => {
    const cmd = buildGrepFunctionPerlCommand('x', [], []);
    assert.ok(cmd.startsWith('echo ">>>"'));
    assert.ok(cmd.endsWith('echo ">>>"'));
  });
});

// ================================================================
//  多路径对比 — 定义 vs 调用区分
// ================================================================
describe('GrepController — definition vs call distinction', () => {
  it('ctags path filters by function name ($1==kw) — only definitions', () => {
    const cmd = buildGrepFunctionCtagsCommand('process', [], []);
    // ctags tags only definitions, awk filters by exact name match
    assert.ok(cmd.includes('$1==kw'));
    // No flip-flop or pattern matching that could match calls
    assert.ok(!cmd.includes('..'));
  });

  it('rg path uses { after ) to identify definitions', () => {
    const cmd = buildGrepFunctionRgCommand('process', [], []);
    // Requires { after closing paren → definition, not call/declaration
    assert.ok(cmd.includes('\\s*\\{'));
  });

  it('perl path uses ) { detection (not just )', () => {
    const cmd = buildGrepFunctionPerlCommand('process', [], []);
    // Paren depth counting + check for { after ) closes
    assert.ok(cmd.includes('$depth'));
    assert.ok(cmd.includes('$check_next'));
    assert.ok(cmd.includes('/\\{\\s*\\$/') || cmd.includes('/^\\s*\\{/'));
  });

  it('old perl flip-flop does NOT distinguish definition from call', () => {
    const cmd = buildGrepFunctionCommandOld('process', [], []);
    // Old approach: just matches keyword( ... ) without checking for {
    assert.ok(cmd.includes('/\\)/'));
    assert.ok(!cmd.includes('tr/'));
    assert.ok(!cmd.includes('$depth'));
  });
});

// ================================================================
//  REGRESSION: 旧版 perl flip-flop（保留对比）
// ================================================================
describe('GrepController — OLD grepFunction (perl flip-flop)', () => {
  it('basic: no includes/excludes', () => {
    const cmd = buildGrepFunctionCommandOld('handleError', [], []);
    assert.ok(cmd.includes('find "." -type f | sort | xargs perl'));
    assert.ok(cmd.includes('/\\bhandleError\\s*\\(/ .. /\\)/'));
    assert.ok(cmd.includes('print "'));
    assert.ok(cmd.includes('>>>'));
  });

  it('with include dirs', () => {
    const cmd = buildGrepFunctionCommandOld('foo', ['src/'], []);
    assert.ok(cmd.includes('find "src/" -type f'));
    assert.ok(!cmd.includes('"."'));
  });

  it('old find does NOT follow symlinks (regression marker)', () => {
    const cmd = buildGrepFunctionCommandOld('foo', [], []);
    assert.ok(!cmd.includes('-L '));
  });
});

// ================================================================
//  REGRESSION: exclude semantics
// ================================================================
describe('GrepController — REGRESSION: exclude semantics', () => {
  it('grepKeyword uses --exclude-dir (basename match)', () => {
    const cmd = buildGrepKeywordCommand('x', [], ['vendor/foo']);
    assert.ok(cmd.includes('--exclude-dir='));
    assert.ok(cmd.includes('_ex0=vendor/foo'));
  });

  it('all grepFunction paths use find -not -path with basename', () => {
    const cmds = [
      buildGrepFunctionCtagsCommand('x', ['proj/'], ['vendor/foo']),
      buildGrepFunctionRgCommand('x', ['proj/'], ['vendor/foo']),
      buildGrepFunctionPerlCommand('x', ['proj/'], ['vendor/foo']),
    ];
    for (const cmd of cmds) {
      assert.ok(cmd.includes('-not -path'), `-not -path missing in: ${cmd.substring(0, 80)}`);
      assert.ok(cmd.includes('_ex0=vendor/foo'), `_ex0 missing in: ${cmd.substring(0, 80)}`);
    }
  });

  it('all commands start with echo separator', () => {
    const cmds = [
      buildGrepKeywordCommand('x', [], []),
      buildGrepFunctionCtagsCommand('x', [], []),
      buildGrepFunctionRgCommand('x', [], []),
      buildGrepFunctionPerlCommand('x', [], []),
    ];
    for (const cmd of cmds) {
      assert.ok(cmd.startsWith('echo'), `Does not start with echo: ${cmd.substring(0, 40)}`);
    }
  });
});

// ================================================================
//  REGRESSION: symlink handling
// ================================================================
describe('GrepController — REGRESSION: symlink handling', () => {
  it('grepKeyword uses -R (follows symlinks)', () => {
    const cmd = buildGrepKeywordCommand('x', [], []);
    assert.ok(cmd.includes('grep -Rn'));
    assert.ok(!cmd.includes('grep -rn '));
  });

  it('ALL new grepFunction paths include find -L (follow symlinks)', () => {
    const cmds = [
      buildGrepFunctionCtagsCommand('x', [], []),
      buildGrepFunctionRgCommand('x', [], []),
      buildGrepFunctionPerlCommand('x', [], []),
    ];
    for (const cmd of cmds) {
      assert.ok(cmd.includes('find -L'), `find -L missing in path`);
    }
  });

  it('old grepFunction find does NOT follow symlinks (regression)', () => {
    const cmd = buildGrepFunctionCommandOld('x', [], []);
    assert.ok(!cmd.includes('-L '));
  });
});

// ================================================================
//  REGRESSION: color output
// ================================================================
describe('GrepController — REGRESSION: color output', () => {
  it('grepKeyword preserves --color=always', () => {
    const cmd = buildGrepKeywordCommand('x', [], []);
    assert.ok(cmd.includes('--color=always'));
  });

  it('ctags path has ANSI red color codes', () => {
    const cmd = buildGrepFunctionCtagsCommand('x', [], []);
    assert.ok(cmd.includes('\\033[1;31m'));
    assert.ok(cmd.includes('\\033[0m'));
  });

  it('rg path has --color=always', () => {
    const cmd = buildGrepFunctionRgCommand('x', [], []);
    assert.ok(cmd.includes('--color=always'));
  });

  it('perl path has ANSI red color codes', () => {
    const cmd = buildGrepFunctionPerlCommand('x', [], []);
    assert.ok(cmd.includes('\\033[1;31m'));
    assert.ok(cmd.includes('\\033[0m'));
  });

  it('old perl path has NO color (regression)', () => {
    const cmd = buildGrepFunctionCommandOld('x', [], []);
    assert.ok(!cmd.includes('\\033'));
    assert.ok(!cmd.includes('--color'));
  });
});

// ================================================================
//  End-to-end output format
// ================================================================
describe('GrepController — END-TO-END: output format', () => {
  it('keyword grep preserves line:content format', () => {
    const cmd = buildGrepKeywordCommand('ERROR', [], []);
    assert.ok(cmd.includes('grep -Rn'));
  });

  it('ctags path outputs filename:line:info format', () => {
    const cmd = buildGrepFunctionCtagsCommand('myFunc', [], []);
    assert.ok(cmd.includes('$2, $3, $0'));
  });

  it('rg path uses default rg format (file:line:content)', () => {
    const cmd = buildGrepFunctionRgCommand('myFunc', [], []);
    assert.ok(cmd.includes('rg -n'));
  });

  it('perl path outputs ARGV:line:content format', () => {
    const cmd = buildGrepFunctionPerlCommand('myFunc', [], []);
    assert.ok(cmd.includes('$ARGV'));
    assert.ok(cmd.includes('$.'));
    assert.ok(cmd.includes('$_'));
  });

  it('all commands have paired >>> separators', () => {
    const cmds = [
      buildGrepKeywordCommand('x', [], []),
      buildGrepFunctionCtagsCommand('x', [], []),
      buildGrepFunctionRgCommand('x', [], []),
      buildGrepFunctionPerlCommand('x', [], []),
    ];
    for (const cmd of cmds) {
      const count = (cmd.match(/>>>/g) || []).length;
      assert.strictEqual(count, 2, `Expected 2 >>> but got ${count}: ${cmd.substring(0, 80)}`);
    }
  });
});

// ================================================================
//  Edge cases
// ================================================================
describe('GrepController — edge cases', () => {
  it('empty keyword escapes without crash', () => {
    assert.strictEqual(escapeRegex(''), '');
  });

  it('very long keyword — no injection', () => {
    const long = 'a'.repeat(10000);
    const cmd = buildGrepKeywordCommand(long, [], []);
    assert.ok(cmd.includes(long));
    assert.ok(!cmd.includes('`'));
    assert.ok(!cmd.includes('$(whoami)'));
  });

  it('keyword with newline passes through', () => {
    const escaped = escapeRegex('line1\nline2');
    assert.ok(escaped.includes('\n'));
  });

  it('includes path with spaces is quoted (all paths)', () => {
    const cmds = [
      buildGrepKeywordCommand('x', ['my path/'], []),
      buildGrepFunctionCtagsCommand('x', ['my path/'], []),
      buildGrepFunctionRgCommand('x', ['my path/'], []),
      buildGrepFunctionPerlCommand('x', ['my path/'], []),
    ];
    for (const cmd of cmds) {
      assert.ok(cmd.includes('"my path/"'), `Path not quoted: ${cmd.substring(0, 80)}`);
    }
  });

  it('perl single-quote safety — keyword with quote', () => {
    const esc = escapeRegex("foo'bar");
    assert.ok(esc.includes("'"));
  });

  it('all paths handle keywords with $ sign', () => {
    const cmds = [
      buildGrepFunctionCtagsCommand('$myFunc', [], []),
      buildGrepFunctionRgCommand('$myFunc', [], []),
      buildGrepFunctionPerlCommand('$myFunc', [], []),
    ];
    for (const cmd of cmds) {
      assert.ok(cmd.includes('$myFunc') || cmd.includes('\\$myFunc'));
    }
  });
});
