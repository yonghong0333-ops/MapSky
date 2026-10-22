// node api/_lib/closureRollover.test.js
const assert = require('assert');
const r = require('./closureRollover');

const at = (iso) => new Date(iso);               // 輸入 UTC；臺北 = UTC+8
const t1759 = at('2026-10-22T09:59:00Z');        // 臺北 17:59
const t1800 = at('2026-10-22T10:00:00Z');        // 臺北 18:00

assert.strictEqual(r.taipeiToday(t1800), '2026-10-22');
assert.strictEqual(r.taipeiTomorrow(t1800), '2026-10-23');
assert.strictEqual(r.taipeiTomorrow(at('2026-12-31T10:00:00Z')), '2027-01-01');

// 18:00 前不換；18:00 後沒換過才換；換過就不再換
assert.strictEqual(r.shouldRollover(t1759, null), false);
assert.strictEqual(r.shouldRollover(t1800, null), true);
assert.strictEqual(r.shouldRollover(t1800, '2026-10-22'), true);
assert.strictEqual(r.shouldRollover(t1800, '2026-10-23'), false);

const stored = {
  高雄市: { status: 'closed', forDate: '2026-10-22' },          // 今天的 → 要換
  屏東縣: { status: 'closed', forDate: '2026-10-23' },          // 已提早公告隔天 → 不動
  宜蘭縣: { status: 'closed', forDate: '2026-10-22' },          // 隔天沒公告 → 移除
};
const tomorrow = {
  高雄市: { status: 'normal' },
  屏東縣: { status: 'normal' },                                  // 就算新資料不同，也不覆蓋已提早公告的
  花蓮縣: { status: 'closed' },                                  // 新增
};
const res = r.rolloverCounties(stored, tomorrow, t1800);
assert.deepStrictEqual(res.counties.高雄市, { status: 'normal', forDate: '2026-10-23' });
assert.deepStrictEqual(res.counties.屏東縣, { status: 'closed', forDate: '2026-10-23' });
assert.strictEqual(res.counties.宜蘭縣, undefined);
assert.deepStrictEqual(res.counties.花蓮縣, { status: 'closed', forDate: '2026-10-23' });
assert.deepStrictEqual(res.kept, ['屏東縣']);

// 抓取失敗：完全不動
const fail = r.rolloverCounties(stored, null, t1800);
assert.strictEqual(fail.counties, stored);
assert.strictEqual(fail.failed, true);
console.log('ok');
