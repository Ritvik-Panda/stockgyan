# StockGyan Admin v2

This package adds a real Cloudflare Pages Functions + D1 foundation for StockGyan content management.

## What it adds
- `/admin.html` PIN login
- Secure HttpOnly session cookie signed with `SESSION_SECRET`
- D1-backed content CRUD
- Content types: Article, Stock Analysis, Mutual Fund, SIP, IPO, NFO, Strategy, Video, PDF
- Draft / Published status
- Search/filter-ready API structure

## Cloudflare setup
1. In the StockGyan Pages project, create a D1 database, e.g. `stockgyan-db`.
2. Run `schema.sql` in the D1 console.
3. Pages project -> Settings -> Functions -> D1 database bindings: bind variable `DB` to the database.
4. Pages project -> Settings -> Variables and Secrets: add `ADMIN_PIN` and `SESSION_SECRET` as encrypted secrets.
5. Commit/push these files to `Ritvik-Panda/stockgyan` on `main`. Cloudflare Pages will deploy them.
6. Open `https://stockgyan.in/admin.html`.

Do not put the real admin PIN or SESSION_SECRET into GitHub. The values belong only in Cloudflare encrypted secrets.

## Next phase
Add Cloudflare R2 upload endpoints for images/PDFs/videos, then connect public pages to published D1 content. Live market prices should use a licensed market-data provider rather than hard-coded values.
