/*
 * StockGyan — Controlled Technical Market Data Refresh
 *
 * Purpose:
 * Upstox → StockGyan backend → D1
 *
 * This endpoint refreshes a small controlled batch of stocks.
 *
 * IMPORTANT:
 * - Protected by HEALTH_REFRESH_SECRET
 * - Maximum 5 stocks per call
 * - Does NOT allow browser users to trigger large scans
 * - Uses StockGyan backend APIs
 * - Stores technical data in D1
 *
 * Data stored:
 * - LTP
 * - Previous Close
 * - 20 DMA
 * - 50 DMA
 * - 100 DMA
 * - 200 DMA
 * - Latest candle date
 *
 * Architecture:
 *
 * Upstox
 *    ↓
 * StockGyan market APIs
 *    ↓
 * technical-market-batch
 *    ↓
 * D1 technical_market_data
 *    ↓
 * Portfolio / Dashboard / Technical Position
 */

export async function onRequestPost(context) {

  try {

    /* =====================================================
       SECURITY
       ===================================================== */

    const refreshSecret =
      context.env.HEALTH_REFRESH_SECRET;

    if (!refreshSecret) {

      return Response.json(
        {
          status: "error",
          message:
            "HEALTH_REFRESH_SECRET is not configured"
        },
        {
          status: 500
        }
      );

    }


    const suppliedSecret =
      context.request.headers.get(
        "X-Refresh-Secret"
      );


    if (
      !suppliedSecret ||
      suppliedSecret !== refreshSecret
    ) {

      return Response.json(
        {
          status: "error",
          message: "Unauthorized"
        },
        {
          status: 401
        }
      );

    }


    /* =====================================================
       DATABASE
       ===================================================== */

    const db =
      context.env.DB;


    if (!db) {

      return Response.json(
        {
          status: "error",
          message:
            "D1 database binding DB is not configured"
        },
        {
          status: 500
        }
      );

    }


    /* =====================================================
       REQUEST
       ===================================================== */

    const body =
      await context.request.json();


    const requestedStocks =
      Array.isArray(body.stocks)
        ? body.stocks
        : [];


    if (!requestedStocks.length) {

      return Response.json(
        {
          status: "error",
          message:
            "No stocks supplied. Send stocks with instrument_key, symbol, company_name and isin."
        },
        {
          status: 400
        }
      );

    }


    /*
     * SAFETY LIMIT
     *
     * Never allow a large request.
     * The scheduler will call this endpoint repeatedly.
     */

    const MAX_BATCH_SIZE = 5;


    if (
      requestedStocks.length >
      MAX_BATCH_SIZE
    ) {

      return Response.json(
        {
          status: "error",
          message:
            "Maximum 5 stocks per refresh request."
        },
        {
          status: 400
        }
      );

    }


    /* =====================================================
       STOCKGYAN MAIN ORIGIN
       ===================================================== */

    /*
     * IMPORTANT:
     *
     * Do NOT use new URL(context.request.url).origin
     *
     * This function may be called from a separate
     * scheduler Worker.
     *
     * Therefore we always use the actual StockGyan
     * production API origin.
     */

    const origin =
      "https://stockgyan.in";


    /* =====================================================
       HELPERS
       ===================================================== */

    function numberValue(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {

        return null;

      }

      const cleaned =
        String(value)
          .replace(/,/g, "")
          .replace(/%/g, "")
          .trim();


      const number =
        Number(cleaned);


      return Number.isFinite(number)
        ? number
        : null;

    }


    function round(value, decimals = 2) {

      if (
        !Number.isFinite(
          Number(value)
        )
      ) {

        return null;

      }

      const multiplier =
        Math.pow(
          10,
          decimals
        );


      return (
        Math.round(
          Number(value) *
          multiplier
        ) /
        multiplier
      );

    }


    function calculateMovingAverage(
      candles,
      period
    ) {

      if (
        !Array.isArray(candles) ||
        candles.length < period
      ) {

        return null;

      }


      const recent =
        candles.slice(
          -period
        );


      let total = 0;


      for (
        const candle of recent
      ) {

        const close =
          numberValue(
            candle.close
          );


        if (
          !Number.isFinite(
            close
          )
        ) {

          return null;

        }


        total += close;

      }


      return round(
        total / period,
        2
      );

    }


    function normalizeCandles(
      rawCandles
    ) {

      if (
        !Array.isArray(
          rawCandles
        )
      ) {

        return [];

      }


      return rawCandles
        .map(
          function(candle) {

            if (
              !Array.isArray(
                candle
              )
            ) {

              return null;

            }


            /*
             * Upstox candle structure:
             *
             * [
             *   timestamp,
             *   open,
             *   high,
             *   low,
             *   close,
             *   volume,
             *   open_interest
             * ]
             */

            const timestamp =
              candle[0];


            const close =
              numberValue(
                candle[4]
              );


            if (
              !timestamp ||
              !Number.isFinite(
                close
              )
            ) {

              return null;

            }


            return {

              timestamp:
                timestamp,

              close:
                close

            };

          }
        )
        .filter(Boolean);

    }


    function latestCandleDate(
      candles
    ) {

      if (
        !candles.length
      ) {

        return null;

      }


      const latest =
        candles[
          candles.length - 1
        ];


      if (
        !latest ||
        !latest.timestamp
      ) {

        return null;

      }


      try {

        return new Date(
          latest.timestamp
        ).toISOString();

      }
      catch (
        error
      ) {

        return null;

      }

    }


    /* =====================================================
       FETCH JSON HELPER
       ===================================================== */

    async function fetchJson(
      url
    ) {

      const response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              "Accept":
                "application/json"
            },

            cache:
              "no-store"
          }
        );


      let data = null;


      try {

        data =
          await response.json();

      }
      catch (
        error
      ) {

        data = null;

      }


      if (
        !response.ok
      ) {

        throw new Error(
          data &&
          data.message
            ? data.message
            : "API request failed"
        );

      }


      return data;

    }


    /* =====================================================
       PROCESS ONE STOCK
       ===================================================== */

    async function processStock(
      stock
    ) {

      const instrumentKey =
        String(
          stock.instrument_key ||
          ""
        ).trim();


      const symbol =
        String(
          stock.symbol ||
          stock.trading_symbol ||
          ""
        ).trim();


      const companyName =
        String(
          stock.company_name ||
          stock.name ||
          symbol ||
          ""
        ).trim();


      const isin =
        String(
          stock.isin ||
          ""
        )
        .trim()
        .toUpperCase();


      if (
        !instrumentKey
      ) {

        return {

          success:
            false,

          symbol:
            symbol,

          isin:
            isin,

          message:
            "Missing instrument_key"

        };

      }


      if (
        !isin
      ) {

        return {

          success:
            false,

          symbol:
            symbol,

          message:
            "Missing ISIN"

        };

      }


      try {

        /* =================================================
           1. HISTORICAL DAILY DATA
           ================================================= */

        const ohlcUrl =
          origin +
          "/api/market/ohlc?instrument_key=" +
          encodeURIComponent(
            instrumentKey
          ) +
          "&interval=1d";


        const ohlcData =
          await fetchJson(
            ohlcUrl
          );


        const rawCandles =
          ohlcData &&
          ohlcData.data &&
          Array.isArray(
            ohlcData.data.candles
          )
            ? ohlcData.data.candles
            : [];


        const candles =
          normalizeCandles(
            rawCandles
          );


        if (
          candles.length === 0
        ) {

          return {

            success:
              false,

            symbol:
              symbol,

            isin:
              isin,

            message:
              "No daily candle data available"

          };

        }


        /* =================================================
           2. MOVING AVERAGES
           ================================================= */

        const dma20 =
          calculateMovingAverage(
            candles,
            20
          );


        const dma50 =
          calculateMovingAverage(
            candles,
            50
          );


        const dma100 =
          calculateMovingAverage(
            candles,
            100
          );


        const dma200 =
          calculateMovingAverage(
            candles,
            200
          );


        /*
         * Latest daily close.
         *
         * This is useful outside market hours and also
         * acts as a fallback when live LTP is unavailable.
         */

        const latestCandle =
          candles[
            candles.length - 1
          ];


        const previousClose =
          numberValue(
            latestCandle.close
          );


        const latestDate =
          latestCandleDate(
            candles
          );


        /* =================================================
           3. LIVE QUOTE
           ================================================= */

        let ltp = null;


        try {

          const quoteUrl =
            origin +
            "/api/market/quote?instrument_key=" +
            encodeURIComponent(
              instrumentKey
            );


          const quoteData =
            await fetchJson(
              quoteUrl
            );


          /*
           * StockGyan quote endpoint can return different
           * response wrappers, so inspect common locations.
           */

          function findQuote(
            value
          ) {

            if (
              !value ||
              typeof value !== "object"
            ) {

              return null;

            }


            if (
              Array.isArray(
                value
              )
            ) {

              for (
                const item of value
              ) {

                const found =
                  findQuote(
                    item
                  );

                if (
                  found
                ) {

                  return found;

                }

              }

              return null;

            }


            const possiblePrice =
              numberValue(
                value.last_price ??
                value.lastPrice ??
                value.ltp ??
                value.last_traded_price ??
                value.close
              );


            if (
              Number.isFinite(
                possiblePrice
              )
            ) {

              return {
                price:
                  possiblePrice
              };

            }


            for (
              const key of Object.keys(
                value
              )
            ) {

              const found =
                findQuote(
                  value[key]
                );


              if (
                found
              ) {

                return found;

              }

            }


            return null;

          }


          const quote =
            findQuote(
              quoteData
            );


          if (
            quote &&
            Number.isFinite(
              quote.price
            )
          ) {

            ltp =
              round(
                quote.price,
                2
              );

          }

        }
        catch (
          quoteError
        ) {

          /*
           * Quote failure must NOT destroy the
           * historical technical data.
           *
           * We simply use previous close as fallback.
           */

          ltp =
            null;

        }


        if (
          !Number.isFinite(
            ltp
          )
        ) {

          ltp =
            previousClose;

        }


        /* =================================================
           4. DATA STATUS
           ================================================= */

        const availableMetrics =
          [
            dma20,
            dma50,
            dma100,
            dma200,
            ltp,
            previousClose
          ]
          .filter(
            function(value) {

              return Number.isFinite(
                value
              );

            }
          )
          .length;


        let dataStatus =
          "pending";


        if (
          availableMetrics >= 4
        ) {

          dataStatus =
            "complete";

        }
        else if (
          availableMetrics > 0
        ) {

          dataStatus =
            "partial";

        }


        /* =================================================
           5. STORE IN D1
           ================================================= */

        /*
         * IMPORTANT:
         *
         * We use UPSERT.
         *
         * Existing good data is replaced only with the
         * new successfully calculated technical values.
         */

        await db
          .prepare(
            `
            INSERT INTO technical_market_data (
              instrument_key,
              symbol,
              company_name,
              isin,
              exchange,
              ltp,
              previous_close,
              dma20,
              dma50,
              dma100,
              dma200,
              latest_candle_date,
              data_status,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT(instrument_key)
            DO UPDATE SET

              symbol =
                excluded.symbol,

              company_name =
                excluded.company_name,

              isin =
                excluded.isin,

              exchange =
                excluded.exchange,

              ltp =
                excluded.ltp,

              previous_close =
                excluded.previous_close,

              dma20 =
                excluded.dma20,

              dma50 =
                excluded.dma50,

              dma100 =
                excluded.dma100,

              dma200 =
                excluded.dma200,

              latest_candle_date =
                excluded.latest_candle_date,

              data_status =
                excluded.data_status,

              updated_at =
                excluded.updated_at
            `
          )
          .bind(
            instrumentKey,
            symbol,
            companyName,
            isin,
            "NSE",
            ltp,
            previousClose,
            dma20,
            dma50,
            dma100,
            dma200,
            latestDate,
            dataStatus,
            new Date().toISOString()
          )
          .run();


        return {

          success:
            true,

          symbol:
            symbol,

          company_name:
            companyName,

          isin:
            isin,

          instrument_key:
            instrumentKey,

          ltp:
            ltp,

          previous_close:
            previousClose,

          dma20:
            dma20,

          dma50:
            dma50,

          dma100:
            dma100,

          dma200:
            dma200,

          latest_candle_date:
            latestDate,

          candle_count:
            candles.length,

          available_metrics:
            availableMetrics,

          data_status:
            dataStatus

        };

      }
      catch (
        error
      ) {

        console.error(
          "StockGyan technical refresh failed:",
          symbol,
          error
        );


        /*
         * IMPORTANT:
         *
         * Do not overwrite existing D1 data with NULL
         * when Upstox temporarily fails.
         */

        return {

          success:
            false,

          symbol:
            symbol,

          isin:
            isin,

          instrument_key:
            instrumentKey,

          message:
            error &&
            error.message
              ? error.message
              : "Technical refresh failed"

        };

      }

    }


    /* =====================================================
       PROCESS BATCH
       ===================================================== */

    const results = [];


    for (
      const stock of requestedStocks
    ) {

      /*
       * Small delay between stocks.
       *
       * This intentionally keeps the refresh gentle
       * on the upstream market API.
       */

      if (
        results.length > 0
      ) {

        await new Promise(
          function(resolve) {

            setTimeout(
              resolve,
              250
            );

          }
        );

      }


      const result =
        await processStock(
          stock
        );


      results.push(
        result
      );

    }


    const refreshed =
      results.filter(
        function(item) {

          return item.success === true;

        }
      ).length;


    const failed =
      results.length -
      refreshed;


    /* =====================================================
       RESPONSE
       ===================================================== */

    return Response.json(
      {
        status:
          "success",

        message:
          "Technical market batch processed",

        batchSize:
          requestedStocks.length,

        refreshed:
          refreshed,

        failed:
          failed,

        results:
          results
      },
      {
        status: 200
      }
    );


  }
  catch (
    error
  ) {

    console.error(
      "StockGyan technical-market-batch error:",
      error
    );


    return Response.json(
      {
        status:
          "error",

        message:
          error &&
          error.message
            ? error.message
            : "Technical market batch failed"
      },
      {
        status: 500
      }
    );

  }

}
