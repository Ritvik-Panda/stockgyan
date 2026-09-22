export async function onRequestGet(context) {
  try {
    const cookie = context.request.headers.get("Cookie") || "";

    // Admin session cookie must exist
    if (!cookie.includes("sg_admin=")) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await context.env.DB
      .prepare(`
        SELECT
          id,
          name,
          phone,
          enquiry_type,
          message,
          status,
          created_at
        FROM enquiries
        ORDER BY id DESC
        LIMIT 200
      `)
      .all();

    return Response.json({
      enquiries: result.results || []
    });

  } catch (error) {
    return Response.json(
      {
        error: "Unable to load enquiries."
      },
      { status: 500 }
    );
  }
}
