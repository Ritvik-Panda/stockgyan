/**
 * StockGyan Portfolio News
 * Cloudflare Pages Function
 *
 * GET /api/portfolio/news?symbols=RELIANCE,TCS,INFY
 *
 * Uses Google News RSS server-side so the browser does not need
 * to call an external news feed directly.
 */

function xmlDecode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getTag(xml, tag) {
  const match = xml.match(
    new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i")
  );

  return match ? xmlDecode(match[1]).trim() : "";
}

function getItems(xml) {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map(function(chunk) {
      const itemXml = "<item" + chunk;

      return {
        title: getTag(itemXml, "title"),
        link: getTag(itemXml, "link"),
        published: getTag(itemXml, "pubDate"),
        source: getTag(itemXml, "source")
      };
    })
    .filter(function(item) {
      return item.title && item.link;
    });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const symbols = url.searchParams
    .get("symbols")
    ?.split(",")
    .map(function(value) {
      return value.trim();
    })
    .filter(Boolean)
    .slice(0, 8) || [];

  if (!symbols.length) {
    return Response.json({
      status: "ok",
      articles: []
    });
  }

  try {
    const responses = await Promise.all(
      symbols.map(async function(symbol) {
        const query = symbol + " stock India";
        const feedUrl =
          "https://news.google.com/rss/search?q=" +
          encodeURIComponent(query) +
          "&hl=en-IN&gl=IN&ceid=IN:en";

        try {
          const response = await fetch(feedUrl, {
            headers: {
              "User-Agent": "StockGyan/1.0"
            }
          });

          if (!response.ok) return [];

          const xml = await response.text();

          return getItems(xml).map(function(article) {
            return {
              title: article.title,
              link: article.link,
              published: article.published,
              source: article.source,
              symbol: symbol
            };
          });
        } catch (error) {
          return [];
        }
      })
    );

    const seen = new Set();
    const articles = responses
      .flat()
      .sort(function(a, b) {
        const ad = new Date(a.published || 0).getTime();
        const bd = new Date(b.published || 0).getTime();
        return bd - ad;
      })
      .filter(function(article) {
        const key = article.link || article.title;

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      })
      .slice(0, 12);

    return Response.json({
      status: "ok",
      articles: articles
    }, {
      headers: {
        "Cache-Control": "public, max-age=300"
      }
    });

  } catch (error) {
    return Response.json({
      status: "error",
      message: "Unable to load portfolio news."
    }, {
      status: 500
    });
  }
}
