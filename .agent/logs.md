 ✓ Starting...
 ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
 ✓ Ready in 1597ms
 ○ Compiling /accounts/[id] ...
[source:PB] accounts.detail(sf9u1fqj1gc7258)
[source:PB] accounts.detail(sf9u1fqj1gc7258)
 ⚠ Cross origin request detected from 192.168.1.39 to /_next/* resource. In a future major version of Next.js, you will need to explicitly configure "allowedDevOrigins" in next.config to allow this.
Read more: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
[source:PB] accounts.detail(sf9u1fqj1gc7258) - success
[source:PB] accounts.detail(sf9u1fqj1gc7258) - success
[source:PB] accounts.list
[source:PB] categories.list
[source:PB] categories.select
[source:PB] shops.list
[source:PB] shops.select
[loadTransactions] Phase 3 routing: {
  accountId: 'sf9u1fqj1gc7258',
  isPBAccountId: true,
  isSBAccountId: false,
  context: 'account'
}
[loadTransactions] Routing to PB (PB account ID detected)
[loadPocketBaseTransactions] Query start: {
  accountId: 'sf9u1fqj1gc7258',
  transactionId: undefined,
  personId: undefined,
  categoryId: undefined,
  shopId: undefined,
  includeVoided: true,
  filters: [
    "(account_id='sf9u1fqj1gc7258' || to_account_id='sf9u1fqj1gc7258')"
  ],
  url: "https://api-db.reiwarden.io.vn/api/collections/pvl_txn_001/records?&filter=(account_id%3D'sf9u1fqj1gc7258'%20%7C%7C%20to_account_id%3D'sf9u1fqj1gc7258')&perPage=2000&sort=-date"
}
[source:PB] accounts.list
[source:PB] accounts.list - success
[source:PB] accounts.list - success
[source:PB] shops.select result { count: 29 }
[source:PB] shops.list - success
[loadPocketBaseTransactions] Fetched from PB: {
  count: 0,
  accountId: 'sf9u1fqj1gc7258',
  filters: "(account_id='sf9u1fqj1gc7258' || to_account_id='sf9u1fqj1gc7258')",
  directMatchCount: 0,
  sample: []
}
[loadTransactions] PB raw rows result: { accountId: 'sf9u1fqj1gc7258', rowCount: 0, sample: [] }
[source:PB] categories.select result { count: 31 }
[source:PB] categories.list - success
[loadTransactions] PB returned empty, falling back via legacy SB mapping: {
  pbAccountId: 'sf9u1fqj1gc7258',
  legacySupabaseId: '0ece401d-36eb-4414-a637-03814c88c216'
}
[loadTransactions] Phase 3 routing: {
  accountId: '0ece401d-36eb-4414-a637-03814c88c216',
  isPBAccountId: false,
  isSBAccountId: true,
  context: 'account'
}
[loadTransactions] Routing to SB (UUID detected or general query)
[loadTransactions] SB results: { count: 6 }
[loadPocketBaseTransactions] Query start: {
  accountId: undefined,
  transactionId: undefined,
  personId: undefined,
  categoryId: undefined,
  shopId: undefined,
  includeVoided: true,
  filters: [],
  url: 'https://api-db.reiwarden.io.vn/api/collections/pvl_txn_001/records?&perPage=2000&sort=-date'
}
[loadPocketBaseTransactions] Fetched from PB: {
  count: 307,
  accountId: undefined,
  filters: '',
  directMatchCount: 307,
  sample: [
    {
      id: '4d0d82dnrcfur15',
      account_id: '',
      to_account_id: '',
      type: 'expense',
      date: '2026-03-06 06:49:05.860Z',
      metadata_status: null
    },
    {
      id: '1o9tb09t7cj0nub',
      account_id: '',
      to_account_id: '',
      type: 'debt',
      date: '2026-03-06 06:26:56.727Z',
      metadata_status: null
    },
    {
      id: 'wfxf3p6yd4mesiq',
      account_id: '',
      to_account_id: '',
      type: 'expense',
      date: '2026-03-06 05:29:13.166Z',
      metadata_status: null
    },
    {
      id: 'a84uyn7u463ppfr',
      account_id: '',
      to_account_id: '',
      type: 'debt',
      date: '2026-03-06 00:00:00.000Z',
      metadata_status: null
    },
    {
      id: 'odrtkrolyhx8lzr',
      account_id: '',
      to_account_id: '',
      type: 'repayment',
      date: '2026-03-06 00:00:00.000Z',
      metadata_status: null
    }
  ]
}
[loadTransactions] PB field backfill from legacy mapping: { requested: 5, successCount: 0, pbAccountId: 'sf9u1fqj1gc7258' }
[loadTransactions] Legacy SB fallback returned rows: {
  count: 6,
  matchedPbIdCount: 5,
  pbAccountId: 'sf9u1fqj1gc7258',
  legacySupabaseId: '0ece401d-36eb-4414-a637-03814c88c216'
}
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 22.7s (compile: 24ms, proxy.ts: 804ms, render: 21.8s)
 GET /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 32.6s (compile: 5.5s, proxy.ts: 2.2s, render: 24.9s)
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 2.2s (compile: 48ms, proxy.ts: 186ms, render: 1962ms)
[source:PB] shops.list
[source:PB] shops.select
 GET /api/refunds/pending?accountId=sf9u1fqj1gc7258&t=1773061368273 200 in 883ms (compile: 583ms, proxy.ts: 281ms, render: 19ms)
 GET /api/batch/pending-items?accountId=sf9u1fqj1gc7258&t=1773061368267 200 in 986ms (compile: 766ms, proxy.ts: 216ms, render: 4ms)
 GET /api/batch/pending-items?accountId=sf9u1fqj1gc7258&t=1773061368273 200 in 965ms (compile: 786ms, proxy.ts: 175ms, render: 4ms)
 GET /api/refunds/pending?accountId=sf9u1fqj1gc7258&t=1773061368267 200 in 998ms (compile: 796ms, proxy.ts: 196ms, render: 6ms)
 GET /api/cashback/stats?accountId=sf9u1fqj1gc7258&cycleTag=2026-02 200 in 1263ms (compile: 791ms, proxy.ts: 283ms, render: 189ms)
[source:PB] shops.select result { count: 29 }
[source:PB] shops.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 1071ms (compile: 16ms, proxy.ts: 178ms, render: 877ms)
[source:PB] categories.list
[source:PB] categories.select
[source:PB] categories.select result { count: 31 }
[source:PB] categories.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 614ms (compile: 25ms, proxy.ts: 183ms, render: 406ms)
[source:PB] accounts.list
[source:PB] accounts.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 21.4s (compile: 21ms, proxy.ts: 176ms, render: 21.2s)
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 1687ms (compile: 54ms, proxy.ts: 181ms, render: 1452ms)
[source:PB] shops.list
[source:PB] shops.select
[source:PB] shops.select result { count: 29 }
[source:PB] shops.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 1216ms (compile: 33ms, proxy.ts: 198ms, render: 985ms)
[source:PB] categories.list
[source:PB] categories.select
[source:PB] categories.select result { count: 31 }
[source:PB] categories.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 605ms (compile: 15ms, proxy.ts: 193ms, render: 396ms)
[source:PB] accounts.list
[source:PB] accounts.list - success
 POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 21.8s (compile: 12ms, proxy.ts: 200ms, render: 21.6s)
[source:PB] accounts.list
[source:PB] accounts.list - success
^C POST /accounts/sf9u1fqj1gc7258?tag=2026-02 200 in 2.3s (compile: 44ms, proxy.ts: 184ms, render: 2.1s)