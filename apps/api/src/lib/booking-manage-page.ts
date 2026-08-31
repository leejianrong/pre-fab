/**
 * The visitor-facing page a booking confirmation email's "cancel" or
 * "reschedule" link points to (SLICES.md Slice 9). Deliberately a small,
 * self-contained HTML document served directly by apps/api — not part of
 * the Astro-built site (a booking's manage link must keep working even if
 * the tenant's own published site is mid-rebuild or has moved, and self-
 * host serves the identical page from its own copy of this same string).
 * The inline script only ever calls the runtime API's own JSON endpoints,
 * the same ones @prefab/blocks' Booking widget calls.
 */
export function renderManageBookingPage(input: { runtimeApiUrl: string; siteId: string; bookingId: string; token: string }): string {
  const { runtimeApiUrl, siteId, bookingId, token } = input;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Manage your booking</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  button { padding: 0.5rem 1rem; border-radius: 0.375rem; border: 1px solid #ccc; background: #fff; cursor: pointer; margin-right: 0.5rem; }
  button.primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  #status { margin-top: 1rem; }
  input[type="datetime-local"] { padding: 0.375rem; }
</style>
</head>
<body>
  <h1>Manage your booking</h1>
  <p id="details">Loading…</p>
  <div id="actions" hidden>
    <button id="cancel" type="button">Cancel booking</button>
    <input id="reschedule-input" type="datetime-local" />
    <button id="reschedule" class="primary" type="button">Reschedule</button>
  </div>
  <p id="status"></p>
  <script>
    var API = ${JSON.stringify(runtimeApiUrl)};
    var siteId = ${JSON.stringify(siteId)};
    var bookingId = ${JSON.stringify(bookingId)};
    var token = ${JSON.stringify(token)};

    function setStatus(text) { document.getElementById("status").textContent = text; }

    function load() {
      fetch(API + "/v1/runtime/bookings/" + siteId + "/" + bookingId + "?token=" + encodeURIComponent(token))
        .then(function (r) { if (!r.ok) throw new Error("not found"); return r.json(); })
        .then(function (booking) {
          document.getElementById("details").textContent = "Booked for " + booking.startsAt + " (" + booking.visitorTimezone + ").";
          document.getElementById("actions").hidden = false;
        })
        .catch(function () { document.getElementById("details").textContent = "This booking could not be found — it may already be canceled."; });
    }

    document.getElementById("cancel").addEventListener("click", function () {
      setStatus("Canceling…");
      fetch(API + "/v1/runtime/bookings/" + siteId + "/" + bookingId + "/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token }),
      })
        .then(function (r) { if (!r.ok) throw new Error("failed"); setStatus("Your booking has been canceled."); })
        .catch(function () { setStatus("Could not cancel — please try again."); });
    });

    document.getElementById("reschedule").addEventListener("click", function () {
      var value = document.getElementById("reschedule-input").value;
      if (!value) { setStatus("Choose a new date and time first."); return; }
      setStatus("Rescheduling…");
      fetch(API + "/v1/runtime/bookings/" + siteId + "/" + bookingId + "/reschedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token, startsAt: new Date(value).toISOString() }),
      })
        .then(function (r) { if (!r.ok) throw new Error("failed"); return r.json(); })
        .then(function (booking) { setStatus("Rescheduled to " + booking.startsAt + "."); })
        .catch(function () { setStatus("That time is no longer available — please try another."); });
    });

    load();
  </script>
</body>
</html>
`;
}
