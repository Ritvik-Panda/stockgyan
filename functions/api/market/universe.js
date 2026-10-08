export async function onRequestGet(context) {

  try {

    /*
     * StockGyan NSE Universe
     *
     * Purpose:
     * Return the NSE equity universe for internal
     * StockGyan backend processes.
     *
     * Upstox → StockGyan → cached NSE universe
     *
     * IMPORTANT:
     * - Does not call Upstox from the browser.
     * - Downloads the official Upstox NSE instrument file.
     * - Correctly handles the .json.gz file.
     * - Uses Cloudflare cache.
     * - Only NSE_EQ / EQ stocks are returned.
     */

    const cache = caches.default;

    const cacheKey = new Request(
      "https://stockgyan.in/api/market/universe"
    );


    /*
     * -----------------------------------------------------
     * CHECK CACHE FIRST
     * -----------------------------------------------------
     */

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }


    /*
     * -----------------------------------------------------
     * UPSTOX NSE INSTRUMENT FILE
     * -----------------------------------------------------
     */

    const url =
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });


    if (!response.ok) {

      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument file returned HTTP " +
            response.status
        },
        {
          status: 502
        }
      );

    }


    /*
     * -----------------------------------------------------
     * READ RESPONSE
     *
     * The Upstox file is .json.gz.
     *
     * Some edge/network paths may return it already
     * decompressed, while others may return the actual
     * gzip bytes.
     *
     * We therefore inspect the first two bytes:
     *
     * gzip magic number = 1F 8B
     *
     * If gzip:
     *     Decompress with DecompressionStream
     *
     * Otherwise:
     *     Read directly as UTF-8 text.
     * -----------------------------------------------------
     */

    let buffer;

    try {

      buffer = await response.arrayBuffer();

    }
    catch (error) {

      return Response.json(
        {
          status: "error",
          message:
            "Unable to read Upstox NSE instrument file",
          detail:
            error?.message ||
            "Unknown response error"
        },
        {
          status: 502
        }
      );

    }


    if (!buffer || buffer.byteLength === 0) {

      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument file is empty"
        },
        {
          status: 502
        }
      );

    }


    /*
     * -----------------------------------------------------
     * DETECT GZIP
     * -----------------------------------------------------
     */

    const bytes =
      new Uint8Array(buffer);

    const isGzip =
      bytes.length >= 2 &&
      bytes[0] === 0x1f &&
      bytes[1] === 0x8b;


    let text;


    /*
     * -----------------------------------------------------
     * DECOMPRESS IF REQUIRED
     * -----------------------------------------------------
     */

    if (isGzip) {

      try {

        const decompressedStream =
          new Response(buffer)
            .body
            .pipeThrough(
              new DecompressionStream("gzip")
            );

        text =
          await new Response(
            decompressedStream
          ).text();

      }
      catch (error) {

        return Response.json(
          {
            status: "error",
            message:
              "Unable to decompress Upstox NSE instrument file",
            detail:
              error?.message ||
              "Unknown decompression error"
          },
          {
            status: 502
          }
        );

      }

    }
    else {

      /*
       * Already plain JSON.
       */

      try {

        text =
          new TextDecoder("utf-8")
            .decode(buffer);

      }
      catch (error) {

        return Response.json(
          {
            status: "error",
            message:
              "Unable to decode Upstox NSE instrument file",
            detail:
              error?.message ||
              "Unknown decoding error"
          },
          {
            status: 502
          }
        );

      }

    }


    /*
     * -----------------------------------------------------
     * VALIDATE RESPONSE TEXT
     * -----------------------------------------------------
     */

    text =
      String(text || "").trim();


    if (!text) {

      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument file contains no text"
        },
        {
          status: 502
        }
      );

    }


    /*
     * -----------------------------------------------------
     * PARSE JSON
     * -----------------------------------------------------
     */

    let instruments;

    try {

      instruments =
        JSON.parse(text);

    }
    catch (error) {

      return Response.json(
        {
          status: "error",
          message:
            "Unable to parse NSE instrument data",
          content_type:
            response.headers.get(
              "content-type"
            ) || "",
          content_encoding:
            response.headers.get(
              "content-encoding"
            ) || "",
          gzip_detected:
            isGzip,
          sample:
            text.substring(0, 200)
        },
        {
          status: 500
        }
      );

    }


    /*
     * -----------------------------------------------------
     * VALIDATE INSTRUMENT ARRAY
     * -----------------------------------------------------
     */

    if (!Array.isArray(instruments)) {

      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument data is not an array"
        },
        {
          status: 500
        }
      );

    }


    /*
     * -----------------------------------------------------
     * NSE EQUITY STOCKS ONLY
     * -----------------------------------------------------
     */

    const stocks =
      instruments

        .filter(function(item) {

          return (
            item &&
            item.segment === "NSE_EQ" &&
            item.instrument_type === "EQ"
          );

        })

        .map(function(item) {

          return {

            symbol:
              item.trading_symbol ||
              null,

            name:
              item.name ||
              null,

            isin:
              item.isin ||
              null,

            instrument_key:
              item.instrument_key ||
              null

          };

        })

        .filter(function(item) {

          return (
            item.instrument_key &&
            item.symbol
          );

        });


    /*
     * -----------------------------------------------------
     * SAFETY CHECK
     * -----------------------------------------------------
     *
     * Never cache an unexpectedly empty universe.
     * -----------------------------------------------------
     */

    if (!stocks.length) {

      return Response.json(
        {
          status: "error",
          message:
            "NSE universe contains zero equity stocks",
          instrument_count:
            instruments.length
        },
        {
          status: 500
        }
      );

    }


    /*
     * -----------------------------------------------------
     * FINAL RESPONSE
     * -----------------------------------------------------
     */

    const result =
      Response.json(
        {
          status: "success",
          count: stocks.length,
          data: stocks
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=21600"
          }
        }
      );


    /*
     * -----------------------------------------------------
     * STORE SUCCESSFUL UNIVERSE IN CLOUDFLARE CACHE
     * -----------------------------------------------------
     *
     * 6 hours.
     * -----------------------------------------------------
     */

    await cache.put(
      cacheKey,
      result.clone()
    );


    return result;


  }
  catch (error) {

    console.error(
      "StockGyan NSE universe error:",
      error
    );


    return Response.json(
      {
        status: "error",
        message:
          error?.message ||
          "Unable to load NSE stock universe"
      },
      {
        status: 500
      }
    );

  }

}
