/**
 * StockGyan Portfolio News v2
 * Cloudflare Pages Function
 *
 * GET /api/portfolio/news?symbols=RELIANCE,TCS,INFY
 *
 * Uses Google News RSS server-side.
 * This version is more tolerant of RSS formatting and uses multiple
 * India/NSE-focused search queries for each portfolio symbol.
 */

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(Number(code));
    })
    .replace(/&#x([0-9a-f]+);/gi, function(_, code) {
      return String.fromCharCode(parseInt(code, 16));
    })
    .trim();
}

function stripTags(value) {
  return decodeXml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(block, tag) {
  const expression = new RegExp(
    "<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">",
    "i"
  );
  const match = block.match(expression);
  return match ? decodeXml(match[1]) : "";
}

function getLink(block) {
  // Standard RSS: <link>https://...</link>
  const link = getTag(block, "link");
  if (link) return link;

  // Some feeds use an Atom-style link element.
  const atom = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return atom ? decodeXml(atom[1]) : "";
}

function parseRss(xml) {
  const matches = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return matches
    .map(function(itemXml) {
      const title = stripTags(getTag(itemXml, "title"));
      const link = getLink(itemXml);
      const published = stripTags(
        getTag(itemXml, "pubDate") || getTag(itemXml, "published")
      );
      const source = stripTags(getTag(itemXml, "source"));
      const description = stripTags(getTag(itemXml, "description"));

      return {
        title: title,
        link: link,
        published: published,
        source: source,
        description: description
      };
    })
    .filter(function(item) {
      return item.title && item.link;
    });
}

function cleanSymbol(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.&_-]/g, "")
    .trim();
}

function buildQueries(symbol) {
  return [
    '"' + symbol + '" NSE stock India',
    '"' + symbol + '" share price India'
  ];
}

async function fetchFeed(query) {
  const feedUrl =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-IN&gl=IN&ceid=IN:en";

  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 StockGyan/2.0",
        "Accept": "application/rss+xml, application/xml, text/xml, */*"
      }
    });

    if (!response.ok) return [];

    const xml = await response.text();
    return parseRss(xml);
  } catch (error) {
    return [];
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map(cleanSymbol)
    .filter(Boolean)
    .slice(0, 8);

  if (!symbols.length) {
    return Response.json({
      status: "ok",
      articles: []
    });
  }

  try {
    const jobs = [];

    symbols.forEach(function(symbol) {
      buildQueries(symbol).forEach(function(query) {
        jobs.push(
          fetchFeed(query).then(function(items) {
            return items.map(function(article) {
              return {
                title: article.title,
                link: article.link,
                published: article.published,
                source: article.source,
                description: article.description,
                symbol: symbol
              };
            });
          })
        );
      });
    });

    const results = await Promise.all(jobs);
    const seen = new Set();

    const articles = results
      .flat()
      .filter(function(article) {
        const key = (article.link || article.title || "")
          .toLowerCase()
          .trim();

        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function(a, b) {
        const ad = new Date(a.published || 0).getTime();
        const bd = new Date(b.published || 0).getTime();
        return bd - ad;
      })
      .slice(0, 20);

    return Response.json(
      {
        status: "ok",
        articles: articles
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300"
        }
      }
    );
  } catch (error) {
    return Response.json(
      {
        status: "error",
        message: "Unable to load portfolio news.",
        articles: []
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
