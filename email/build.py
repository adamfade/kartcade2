#!/usr/bin/env python3
"""Build Kartcade marketing emails (Mailchimp "Code your own" HTML) in the August-2026 style.

Usage: python3 email/build.py   -> writes email/dist/<slug>.html
Images are served from https://www.kartcade.com/email/ (public/email in this repo).
Edit the EMAILS list to change copy; every email shares one layout.
"""
import html, os, pathlib

SITE = "https://www.kartcade.com"
IMG = SITE + "/email"
GIFT = "https://giftup.app/place-order/dd0ba2da-46cb-4e33-43c4-08de38bb5f40?platform=hosted"
RED, GREEN, BLUE, BLACK = "#D42428", "#2D9E49", "#6CA6E0", "#0A0A0A"
FONT = "Helvetica, Arial, sans-serif"
HOURS = "Wed &amp; Thu 2&ndash;8pm &middot; Fri 2&ndash;9pm &middot; Sat 10am&ndash;9pm &middot; Sun 10am&ndash;7pm"
GAMES = ["NASCAR", "iRacing", "BeamNG.drive", "Wreckfest", "Drift", "Microsoft Flight Simulator", "DCS World"]

e = html.escape


def utm(url, slug):
    if not url.startswith(SITE):
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}utm_source=mailchimp&utm_medium=email&utm_campaign={slug}"


def button(text, url):
    return f"""
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
  <tr><td align="center" bgcolor="{RED}" style="border-radius:6px;">
    <a href="{e(url)}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:{FONT};font-size:17px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;text-transform:uppercase;border-radius:6px;">{e(text)}</a>
  </td></tr>
</table>"""


def photo(name, alt):
    return f"""
<tr><td style="padding:32px 0 0 0;"><img src="{IMG}/{name}" width="600" alt="{e(alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>"""


def price_row():
    cells = [("Karts", "$30"), ("Sim rigs", "$40"), ("Flight", "$40"), ("Motion", "$50")]
    tds = "".join(
        f'<td align="center" width="25%" style="padding:6px;font-family:{FONT};">'
        f'<div style="font-size:22px;font-weight:bold;color:#ffffff;">{p}</div>'
        f'<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8A8A8A;">{n}</div></td>'
        for n, p in cells
    )
    return f"""
<tr><td style="padding:24px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>{tds}</tr></table>
<p style="margin:6px 0 0 0;text-align:center;font-family:{FONT};font-size:12px;color:#8A8A8A;">per person, per hour &middot; everyone gets their own rig</p></td></tr>"""


def secondary(kind, slug):
    if kind == "party":
        head, big, small, line = "Rent the entire space", "$400", "for two hours, up to 40 people", "Birthdays &middot; Team building &middot; Reunions"
        link = (utm(SITE + "/events", slug), "Plan a private event")
    elif kind == "gift":
        head, big, small, line = "Give the gift of speed", "Gift cards", "delivered by email in seconds", "Holidays &middot; Birthdays &middot; Stocking stuffers"
        link = (GIFT, "Buy a gift card")
    else:  # leaderboard
        head, big, small, line = "Hot Lap Challenge", "Free hour", "for the fastest lap each month", "Post a time every session &middot; Top 10 race the final"
        link = (utm(SITE + "/leaderboard", slug), "See the leaderboard")
    return f"""
<tr><td align="center" style="padding:44px 40px 0 40px;font-family:{FONT};">
  <div style="font-size:24px;font-weight:bold;font-style:italic;color:#ffffff;">{head}</div>
  <div style="width:60px;height:2px;background:{RED};margin:12px auto 18px auto;line-height:2px;font-size:0;">&nbsp;</div>
  <div style="font-size:16px;color:#C9C9C9;"><span style="font-size:30px;font-weight:bold;color:#ffffff;">{big}</span>&nbsp; {small}</div>
  <div style="font-size:13px;color:#8A8A8A;padding-top:10px;">{line.replace('&middot;', f'<span style="color:{RED};">&middot;</span>')}</div>
  <div style="padding-top:14px;"><a href="{e(link[0])}" style="font-family:{FONT};font-size:14px;font-weight:bold;color:{GREEN};text-decoration:none;">{link[1]} &rarr;</a></div>
</td></tr>"""


def games():
    names = f' <span style="color:#555555;">|</span> '.join(f'<span style="white-space:nowrap;">{g}</span>' for g in GAMES)
    return f"""
<tr><td align="center" style="padding:44px 30px 0 30px;font-family:{FONT};">
  <div style="font-size:11px;font-weight:bold;letter-spacing:3px;color:#8A8A8A;">WHAT YOU CAN DRIVE &amp; FLY</div>
</td></tr>
<tr><td style="padding:14px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td align="center" bgcolor="#000000" style="padding:16px 18px;font-family:{FONT};font-size:14px;font-weight:bold;font-style:italic;line-height:26px;color:#ffffff;">{names}</td>
</tr></table></td></tr>"""


def hsize(text):
    # Long hero lines shrink so they stay on one line (about 0.62em per uppercase italic character).
    n = len(html.unescape(text))
    return max(34, min(58, int(540 / (0.62 * max(n, 1)))))


def render(m):
    slug = m["slug"]
    hs = min(hsize(m["h1"]), hsize(m["h2"]))
    url = utm(m["url"], slug) if m["url"] != "GIFT" else GIFT
    extra = price_row() if m.get("prices") else ""
    second = secondary(m.get("secondary", "party"), slug)
    note = f'<p style="margin:18px 0 0 0;font-family:{FONT};font-size:13px;line-height:20px;color:#8A8A8A;text-align:center;">{m["fine"]}</p>' if m.get("fine") else ""
    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>{e(m['subject'])}</title>
<style>
  body {{ margin:0; padding:0; background:{BLACK}; }}
  a {{ color:{GREEN}; }}
  @media only screen and (max-width:620px) {{
    .wrap {{ width:100% !important; }}
    .h1 {{ font-size:34px !important; line-height:36px !important; }}
    .pad {{ padding-left:22px !important; padding-right:22px !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background:{BLACK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{BLACK};">{e(m['preheader'])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BLACK}" style="background:{BLACK};">
<tr><td align="center">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="{BLACK}" style="width:600px;max-width:600px;background:{BLACK};">

<!-- HERO -->
<tr><td background="{IMG}/hero-lounge.jpg" bgcolor="#0B1736" valign="top" style="background-image:url('{IMG}/hero-lounge.jpg');background-size:cover;background-position:center;background-color:#0B1736;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" class="pad" style="padding:34px 30px 40px 30px;font-family:{FONT};">
    <a href="{utm(SITE, slug)}"><img src="{SITE}/logo.png" width="200" alt="Kartcade" style="display:block;width:200px;height:auto;border:0;margin:0 auto 26px auto;"></a>
    <div class="h1" style="font-size:{hs}px;line-height:{hs}px;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-1px;color:#ffffff;">{m['h1']}</div>
    <div class="h1" style="font-size:{hs}px;line-height:{hs+4}px;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-1px;color:{RED};">{m['h2']}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0 auto;"><tr>
      <td width="40" style="border-top:1px solid {RED};font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:0 12px;font-family:{FONT};font-size:15px;font-weight:bold;font-style:italic;letter-spacing:1px;text-transform:uppercase;color:#ffffff;white-space:nowrap;">{m['s1']}</td>
      <td width="40" style="border-top:1px solid {RED};font-size:0;line-height:0;">&nbsp;</td>
    </tr></table>
    <div style="padding-top:6px;font-size:18px;font-weight:bold;font-style:italic;text-transform:uppercase;color:{GREEN};">{m['s2']}</div>
  </td></tr></table>
</td></tr>
<tr><td bgcolor="{RED}" style="height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>

<!-- OFFER -->
<tr><td align="center" class="pad" style="padding:44px 50px 0 50px;font-family:{FONT};">
  <div style="font-size:34px;line-height:40px;font-weight:bold;color:#ffffff;">{m['title']}</div>
  <div style="padding-top:12px;font-size:19px;font-weight:bold;text-transform:uppercase;color:{GREEN};">{m['sub']}</div>
  <div style="padding-top:8px;font-size:13px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:{BLUE};">{m['kicker']}</div>
  <p style="margin:18px 0 26px 0;font-size:16px;line-height:25px;color:#C9C9C9;">{m['body']}</p>
  {button(m['cta'], url)}
  {note}
</td></tr>
{extra}
{photo(m.get('photo', 'rig.jpg'), m.get('photo_alt', 'Racing simulator at Kartcade'))}
{second}
{games()}

<!-- FOOTER -->
<tr><td class="pad" style="padding:40px 40px 0 40px;"><div style="border-top:1px solid #2B2B2B;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
<tr><td align="center" class="pad" style="padding:26px 40px 40px 40px;font-family:{FONT};font-size:14px;line-height:22px;color:#8A8A8A;">
  <div style="font-weight:bold;color:#ffffff;">Kartcade</div>
  <div>18750 Willamette Dr, West Linn, OR 97068</div>
  <div><a href="tel:+15034909194" style="color:#8A8A8A;text-decoration:none;">503-490-9194</a> &middot; <a href="{utm(SITE, slug)}" style="color:#8A8A8A;text-decoration:none;">kartcade.com</a></div>
  <div style="padding-top:6px;font-size:12px;">{HOURS}</div>
  <div style="padding-top:22px;font-size:12px;color:#5F5F5F;">You're getting this because you booked or made an account at Kartcade.<br>
  <a href="*|UNSUB|*" style="color:#5F5F5F;">Unsubscribe</a> &middot; <a href="*|UPDATE_PROFILE|*" style="color:#5F5F5F;">Update preferences</a></div>
  <div style="padding-top:10px;font-size:11px;color:#4A4A4A;">*|LIST:ADDRESSLINE|*</div>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
"""


EMAILS = [
    # ---------- 8-week campaign ----------
    dict(slug="01-on-the-list", send="Thu Oct 22", subject="You're on the Kartcade list (and it's raining)",
         preheader="New hours, a monthly lap challenge, and a dry place to go fast.",
         h1="Rain outside.", h2="Full throttle inside.", s1="You're on the Kartcade list", s2="Here's what's new",
         title="New hours. Same speed.", sub="Race &middot; Fly &middot; Compete", kicker="Open Wednesday to Sunday",
         body="You're getting this because you've raced with us or made a Kartcade account. Expect a few emails a month: new challenges, events and the occasional perk. Not for you? Unsubscribe at the bottom, no hard feelings.",
         cta="Book a session", url=SITE + "/book", secondary="party"),
    dict(slug="02-hot-lap-launch", send="Thu Nov 5", subject="Think you're fast? Prove it.",
         preheader="The Hot Lap Challenge starts Nov 11. Fastest lap wins a free hour.",
         h1="Hot Lap", h2="Challenge", s1="New car. New track.", s2="Every month",
         title="Think you're fast?", sub="Starts Wednesday, Nov 11", kicker="Fastest lap wins a free hour",
         body="Every racing session can post a time to the Kartcade leaderboard. One car, one track, all month. The fastest lap wins a free hour, and the top 10 race head-to-head in the final on the last Sunday of the month.",
         cta="See the leaderboard", url=SITE + "/leaderboard", secondary="party"),
    dict(slug="03-bring-the-crew", send="Fri Nov 13", subject="Rainy weekend? Bring the whole crew.",
         preheader="10 simulators side by side. Everyone races at once.",
         h1="Bring the", h2="whole crew", s1="10 sims, side by side", s2="Everyone races at once",
         title="Rainy weekend, solved.", sub="Karts from age 5", kicker="Priced per person",
         body="Everyone gets their own simulator, so nobody waits for a turn. Karts for the kids, direct-drive rigs and a full-motion sim for the grown-ups, and a flight sim for anyone who'd rather fly.",
         cta="Book for your group", url=SITE + "/book", prices=True, photo="lounge.jpg",
         photo_alt="The Kartcade lounge with drivers racing", secondary="leaderboard"),
    dict(slug="04-gift-cards", send="Sun Nov 15", subject="The gift that goes fast",
         preheader="Kartcade gift cards, delivered by email in seconds.",
         h1="The gift that", h2="goes fast", s1="Kartcade gift cards", s2="Delivered in seconds",
         title="Skip the sweater this year.", sub="Racing &middot; Flying &middot; Parties", kicker="You pick the amount",
         body="Give a race, a flight or a whole party. Gift cards arrive by email in seconds and work on every simulator in the lounge.",
         cta="Buy a gift card", url="GIFT", photo="flight.jpg", photo_alt="The Kartcade flight simulator",
         secondary="party"),
    dict(slug="05-black-friday", send="Fri Nov 27", subject="Black Friday, green flag",
         preheader="Skip the mall. Gift cards for every racer on your list.",
         h1="Black Friday.", h2="Green flag.", s1="Gift cards for everyone", s2="On your list",
         title="Out of the crowds, into the seat.", sub="Gift cards in seconds", kicker="Then book a lap for yourself",
         body="Knock out the racers on your list from your couch, then come take the edge off with a session of your own.",
         cta="Buy a gift card", url="GIFT", photo="rig.jpg", secondary="leaderboard"),
    dict(slug="06-holiday-parties", send="Wed Dec 9", subject="The holiday party nobody skips",
         preheader="Rent the whole lounge: $400 for two hours, up to 40 people.",
         h1="Holiday party?", h2="Take the grid.", s1="Rent the whole lounge", s2="$400 for two hours",
         title="The team outing nobody skips.", sub="Up to 40 people", kicker="Book your December date",
         body="All 10 simulators, the whole lounge, two hours of racing and flying for your team, family or friends. Bring food, run a tournament, crown a champion.",
         cta="Book a private event", url=SITE + "/book-party", photo="lounge.jpg",
         photo_alt="The Kartcade lounge", secondary="gift"),
    dict(slug="07-last-minute-gifts", send="Fri Dec 18", subject="Last-minute gift, sorted",
         preheader="Gift cards arrive by email in seconds. Plus: the Hot Lap final is Dec 27.",
         h1="Last-minute", h2="gift, sorted", s1="Arrives by email", s2="In seconds",
         title="Still shopping? We've got you.", sub="Gift cards in seconds", kicker="Hot Lap final: Sunday, Dec 27",
         body="Print it, forward it, or tuck it in a card. And if you're on the leaderboard, the top 10 race for the title on Sunday, December 27.",
         cta="Buy a gift card", url="GIFT", photo="flight.jpg", photo_alt="The Kartcade flight simulator",
         secondary="leaderboard"),
    dict(slug="08-new-year", send="Wed Dec 30", subject="New year. New lap record.",
         preheader="January's Hot Lap Challenge starts now.",
         h1="New year.", h2="New lap record.", s1="January's Hot Lap", s2="Starts now",
         title="Make it your fastest year.", sub="New car &middot; New track", kicker="Fastest lap wins a free hour",
         body="Shake off the holidays in the driver's seat. January's challenge is live, the leaderboard is wiped clean, and the top spot is up for grabs.",
         cta="Book a session", url=SITE + "/book", secondary="party"),
    # ---------- automations ----------
    dict(slug="auto-intro-20", send="3 days after sign-up (tag: Account, never booked)",
         subject="Your first hour at Kartcade is $20",
         preheader="Any simulator, first hour $20. Valid for 14 days.",
         h1="Your first hour", h2="is $20", s1="Welcome to Kartcade", s2="Let's get you on track",
         title="You made an account. Now take a lap.", sub="Any simulator &middot; First hour $20", kicker="Valid for 14 days",
         body="Book online and choose to pay at the venue, then show this email at the counter. Your first hour on any simulator is $20: karts, sim rigs, the motion rig or the flight sim.",
         fine="One per person, first visit only, within 14 days of this email.",
         cta="Book my $20 hour", url=SITE + "/book", secondary="leaderboard"),
    dict(slug="auto-welcome", send="After first booking (tag: Customer)",
         subject="Welcome to the grid",
         preheader="Thanks for racing with us. Here's how to come back faster.",
         h1="Welcome to", h2="the grid", s1="Thanks for racing with us", s2="Come back faster",
         title="Your lap time is waiting.", sub="Post it on the leaderboard", kicker="Every session counts",
         body="Every visit can post a time to the Hot Lap leaderboard. Beat it next time, climb the board, and the fastest lap of the month wins a free hour.",
         cta="See the leaderboard", url=SITE + "/leaderboard", secondary="party"),
    dict(slug="auto-winback-45", send="45 days after last visit (Last visit field)",
         subject="The track misses you",
         preheader="New car, new track, and your seat's still open.",
         h1="The track", h2="misses you", s1="It's been a while", s2="Your seat's still open",
         title="Something new every month.", sub="New car &middot; New track", kicker="Fastest lap wins a free hour",
         body="The Hot Lap Challenge changes every month, so there's always a new time to beat. Grab a friend and come see where you'd land on the board.",
         cta="Book a session", url=SITE + "/book", photo="karts.jpg", photo_alt="A Kartcade racing rig",
         secondary="party"),
]

if __name__ == "__main__":
    out = pathlib.Path(__file__).parent / "dist"
    out.mkdir(exist_ok=True)
    for m in EMAILS:
        (out / f"{m['slug']}.html").write_text(render(m))
    rows = "\n".join(f"| {m['slug']} | {m['send']} | {m['subject']} | {m['preheader']} |" for m in EMAILS)
    (out / "README.md").write_text(
        "# Kartcade emails\n\nUpload each file in Mailchimp: Create > Email > Code your own > Paste in code.\n\n"
        "| File | Send | Subject | Preview text |\n|---|---|---|---|\n" + rows + "\n")
    print(f"wrote {len(EMAILS)} emails to {out}")
