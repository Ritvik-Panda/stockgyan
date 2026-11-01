
async function downloadInstrumentFile(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/gzip, application/json, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Instrument download failed: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const isGzip =
    bytes.length >= 2 &&
    bytes[0] === 0x1f &&
    bytes[1] === 0x8b;

  let jsonText;

  if (isGzip) {
    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));

    jsonText = await new Response(stream).text();
  } else {
    jsonText = new TextDecoder().decode(buffer);
  }

  const data = JSON.parse(jsonText);

  if (!Array.isArray(data)) {
    throw new Error("Invalid instrument master format");
  }

  return data;
}

async function getInstrumentMaster() {
  const base =
    "https://assets.upstox.com/market-quote/instruments/exchange/";

  try {
    return await downloadInstrumentFile(
      base + "complete.json.gz"
    );
  } catch (error) {
    const results = await Promise.allSettled([
      downloadInstrumentFile(base + "NSE.json.gz"),
      downloadInstrumentFile(base + "BSE.json.gz")
    ]);

    const combined = results
      .filter(item => item.status === "fulfilled")
      .flatMap(item => item.value);

    if (combined.length) return combined;

    throw new Error(
      "Unable to download NSE/BSE instrument master"
    );
  }
}

export async function onRequest(context) {
  const db = context.env.ADVANCED_DB;

  if (!db) {
    return Response.json({
      success: false,
      message: "ADVANCED_DB binding not configured"
    }, { status: 500 });
  }

  try {
    // Use the same equity selection as the working
    // StockGyan Upstox market-data API.

    const instruments = await getInstrumentMaster();

    const nseSeries = ["EQ", "BE", "BZ", "SM", "ST", "SZ"];
    const bseSeries = ["A", "B", "T", "X", "XT", "Z"];

    const stocks = instruments.filter(stock => {
      if (
        !stock.instrument_key ||
        !stock.trading_symbol
      ) {
        return false;
      }

      if (stock.segment === "NSE_EQ") {
        return nseSeries.includes(stock.instrument_type);
      }

      if (stock.segment === "BSE_EQ") {
        return bseSeries.includes(stock.instrument_type);
      }

      return false;
    });

    if (!stocks.length) {
      throw new Error("No eligible equity instruments found");
    }

    let imported = 0;
    let nseCount = 0;
    let bseCount = 0;

    // Keep database writes in manageable batches.
    const batchSize = 100;

    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);

      const statements = batch.map(stock => {
        const exchange =
          stock.segment === "NSE_EQ" ? "NSE" : "BSE";

        return db.prepare(`
          INSERT INTO companies (
            exchange,
            symbol,
            company_name,
            isin,
            instrument_key,
            instrument_type,
            active,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(exchange, symbol)
          DO UPDATE SET
            company_name = excluded.company_name,
            isin = excluded.isin,
            instrument_key = excluded.instrument_key,
            instrument_type = excluded.instrument_type,
            active = 1,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          exchange,
          stock.trading_symbol,
          stock.name || stock.trading_symbol,
          stock.isin || null,
          stock.instrument_key,
          stock.instrument_type || null
        );
      });

      await db.batch(statements);

      imported += batch.length;

      for (const stock of batch) {
        if (stock.segment === "NSE_EQ") {
          nseCount++;
        } else if (stock.segment === "BSE_EQ") {
          bseCount++;
        }
      }
    }

    return Response.json({
      success: true,
      message: "Company master imported successfully",
      database: "stockgyan-advanced-db",
      summary: {
        imported_instruments: imported,
        nse_instruments: nseCount,
        bse_instruments: bseCount,
        batch_size: batchSize
      }
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: error.message || "Import failed"
    }, { status: 500 });
  }
}
