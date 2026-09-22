export async function onRequestPost(context) {
  try {
    const data = await context.request.json();

    const name = String(data.name || "").trim();
    const phone = String(data.phone || "").trim();
    const enquiryType = String(data.enquiry_type || "").trim();
    const message = String(data.message || "").trim();

    if (!name || !phone) {
      return Response.json(
        {
          ok: false,
          error: "Name and phone are required."
        },
        { status: 400 }
      );
    }

    const result = await context.env.DB
      .prepare(`
        INSERT INTO enquiries
        (name, phone, enquiry_type, message)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        name,
        phone,
        enquiryType,
        message
      )
      .run();

    return Response.json({
      ok: true,
      id: result.meta.last_row_id
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "Unable to save enquiry."
      },
      { status: 500 }
    );
  }
}
