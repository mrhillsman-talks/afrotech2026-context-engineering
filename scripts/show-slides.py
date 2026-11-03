#!/usr/bin/env python3
"""Generates the run-of-show slides in slides/ from the copy below.

The deck is chunked into six themes. Each theme gets a mint SETUP slide (the idea, and what the room does in each
of its presets) shown before the live stretch, and a forest LESSONS slide shown after it. A legend slide precedes
the lobby, a recap follows the last theme, and one STATEMENT slide (20, Context Window Architecture) sits before
part 6. A SCENARIO slide (05, Project Atlas) comes before the legend and ties the six parts to the one question. The TITLE slide (02) carries a placeholder speaker line. Run `python3 scripts/show-slides.py` after editing the copy. Fonts and artwork come from slides/src. Set CANVAS_OUT to a folder holding a blobs.json (asset urls) to also emit the
Design-canvas artboards; that is only needed to update the canvas."""
import base64, json, os, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, SLIDES, CANVAS = ROOT + "/slides/src", ROOT + "/slides", os.environ.get("CANVAS_OUT")
BLOBS = json.load(open(CANVAS + "/blobs.json")) if CANVAS and os.path.exists(CANVAS + "/blobs.json") else None

def b64(p): return base64.b64encode(open(p, "rb").read()).decode()
FONT = {"display": b64(SRC + "/FunnelDisplay-Variable.woff2"), "sans": b64(SRC + "/FunnelSans-Variable.woff2")}
IMG = {k: b64("%s/afrotech-%s.png" % (SRC, k.replace("lockup-", "conference-lockup-"))) for k in ("lockup-forest", "mark-forest", "lockup-white", "mark-white")}
ART = {"floorplan": b64(SRC + "/floorplan.png")}   # artwork for the statement slide, taken from the exported AfroTech deck
C = dict(forest="#1c403e", lift="#1c5a45", mint="#edf3f3", lime="#9aff36", green="#1fb155", frost="#eaf4ff", white="#ffffff", rule="#95a6a2")
X, W = 111, 809          # content left edge and width on the 960x540 stage
FD, FS = 0.5, 0.5        # average glyph width as a fraction of the size: Funnel Display, Funnel Sans

# ---------- content ----------
# (file stem, eyebrow theme, title, [(preset, name, what the room does)], [lessons])
THEMES = [
 ("07-part1-one-assistant", "PART 1: ONE ASSISTANT, ONE BUDGET", "Your own assistant. It can’t have everything.",
  [("01", "Solo", "Pick cards within 80 units, then run."),
   ("02", "Context pressure", "Budget cut to 45. Keep, summarize or remove.")],
  ["The same model behaves differently because it sees a different world.",
   "You can make room by rewriting information shorter, not just by deleting it."]),
 ("09-part2-a-real-system", "PART 2: A REAL SYSTEM", "One user is easy. Now the whole room feeds one window.",
  [("03", "Shared chaos", "Role holders send. Others submit one sentence."),
   ("04", "Crowd managed", "389 units for 300. Spend 100 relevance credits."),
   ("05", "Real-time update", "Poll: ignore, evict, summarize or retrieve.")],
  ["Real assistants receive information from multiple actors and systems.",
   "Someone or something must decide what deserves attention.",
   "Context must be maintained as reality changes."]),
 ("11-part3-wrong-context", "PART 3: RIGHT INFORMATION, WRONG CONTEXT", "True, relevant, retrieved. Still not allowed in.",
  [("06", "Scoped", "Apollo’s fact is true. About this project? Poll."),
   ("07", "Privacy", "Another user’s memory. May it be used? Poll."),
   ("08", "Trusted", "A web page gives orders. Data or instruction? Poll.")],
  ["True information can still be wrong context.",
   "Relevant information can still be off limits.",
   "Retrieved text is information, not instructions."]),
 ("13-part4-beyond-the-window", "PART 4: BEYOND THE WINDOW", "Does forgetting something mean we lost it?",
  [("09", "Retrieval", "The contract is gone. Vote which result returns."),
   ("10", "Reveal pipeline", "Watch. Every toggle is a decision you made today.")],
  ["Information does not have to stay in the active window to remain available.",
   "Almost everything happened before the model generated a word."]),
 ("15-part5-who-runs-the-machinery", "PART 5: WHO RUNS THE MACHINERY", "Buy, blend, build. Who owns the decisions?",
  [("11", "Buy", "Toggle the four sources the assistant may use."),
   ("12", "Blend", "Toggle eight sources. Enabling is not copying."),
   ("13", "Build", "Watch the window change as the dials move.")],
  ["Context engineering still occurs when a vendor operates the machinery.",
   "Every source you connect adds more to choose from, and the choosing is yours.",
   "The more of the system you own, the more of these decisions you own."]),
 ("21-part6-same-model", "PART 6: SAME MODEL", "Same question. Same model. Engineered context.",
  [("14", "Final", "See the answer on your device. Model unchanged."),
   ("15", "Close", "Read the definition. The event log replays.")],
  ["Better context can change behavior without changing the model.",
   "Context engineering is how we choose and maintain the information available to an assistant as it works."]),
]
LESSON_STEMS = {"07-part1-one-assistant": "08-part1-lessons", "09-part2-a-real-system": "10-part2-lessons",
                "11-part3-wrong-context": "12-part3-lessons", "13-part4-beyond-the-window": "14-part4-lessons",
                "15-part5-who-runs-the-machinery": "19-part5-lessons", "21-part6-same-model": "22-part6-lessons"}
LEGEND = dict(eyebrow="LIVE: HOW TO READ THE SCREEN", title="You are about to run a context window.",
  sub="No device needed. Watch the screen. A slide sets up each part, then the room runs it live.",
  cards=[("Card", "One piece of information the assistant could see. X-ray shows its source, age and authority."),
         ("Unit", "What a card costs. The window has a budget, and the room goes over it more than once."),
         ("Window", "The cards the assistant actually sees when it answers. Everything else is invisible to it."),
         ("A card can be", "Evicted: pushed out of the window. Compressed: shrunk to a summary. Quarantined: held aside, never obeyed.")])
# The scenario slide, shown before the legend: Project Atlas and its one question, then the six parts it runs through.
SCENARIO = dict(stem="05-project-atlas", eyebrow="THE SCENARIO: PROJECT ATLAS",
  title="What should Project Atlas do for Tuesday’s production launch?",
  sub="A fictional product with a big customer launch. Six parts, one question.",
  # Each part's own slide names it; here each gets the operator it practises, in the words of
  # docs/misc/context_engineering_tools.md (its operator table, and GOVERN from its wrapping layer).
  # (operator, how that part of the talk practises it)
  parts=[("Budget", "Fit the window to 80 units, then 45. Summarize before you cut."),
         ("Prioritize", "The room spends credits on what gets into the window as facts change."),
         ("Filter", "Keep out another project, another user’s data, a web page’s orders."),
         ("Retrieve", "Bring the contract back after it falls out of the window."),
         ("Tailor", "Decide who runs the sources and dials when you buy, blend or build."),
         ("Evaluate", "Same question, same model. Check the answer the new context gives.")])
RECAP = dict(eyebrow="CLOSE: WHAT WE LEARNED",
  title="Context engineering is how we choose and maintain the information available to an assistant as it works.",
  items=["Different world, different answer.", "Shorten before you delete.", "Someone must decide what gets attention.",
         "Maintain context as reality changes.", "True can still be the wrong context.", "Relevant can still be off limits.",
         "Retrieved text is data, not instruction.", "Out of the window is not lost.", "Most of it happens before the model speaks.",
         "Better context, same model, better behavior."])
# A single statement slide: eyebrow, a title set one word per line, the four planes with the question each answers, artwork on
# the right. CWA is a specification, not a framework. The questions are the spec's own wording for what each plane answers.
STATEMENT = dict(stem="20-cwa", eyebrow="THE DRAFT SPECIFICATION", title="Context Window Architecture", art="floorplan", caption="before preset 14",
  planes=[("Governance", "Who may direct the model?"), ("State", "What is true right now?"),
          ("Evidence", "What may the model ground on?"), ("Interaction", "What has happened, and what is asked?")])
# The title slide, shown as the talk starts. The speaker line is a placeholder: fill it in before the talk.
TITLE = dict(stem="02-title", title="Context Engineering", sub="AI Productivity in Your Day to Day",
  quote="The totality is not, as it were, a mere heap, but the whole is something besides the parts.",
  source="Aristotle, Metaphysics, Book VIII (1045a)", speaker=["[Your name]", "[Your role], [Your company]"])

# ---------- text fitting ----------
def wrap(t, size, width, f):
    lines, cur = [], ""
    for w in t.split():
        cand = (cur + " " + w).strip()
        if not cur or len(cand) * size * f <= width: cur = cand
        else: lines.append(cur); cur = w
    return lines + [cur]
def fit(t, sizes, width, f, maxlines):
    for s in sizes:
        L = wrap(t, s, width, f)
        if len(L) <= maxlines: return s, L
    return sizes[-1], wrap(t, sizes[-1], width, f)
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# ---------- svg ----------
STYLE = ('<style>@font-face{font-family:"Funnel Display";src:url(data:font/woff2;base64,%s) format("woff2");font-weight:300 800}'
         '@font-face{font-family:"Funnel Sans";src:url(data:font/woff2;base64,%s) format("woff2");font-weight:300 800}</style>' % (FONT["display"], FONT["sans"]))
def stext(x, y, lines, size, fam, weight, fill, pitch, extra=""):
    ts = "".join('<tspan x="%s" %s="%s">%s</tspan>' % (x, "y" if i == 0 else "dy", y if i == 0 else round(pitch, 2), esc(l)) for i, l in enumerate(lines))
    return '<text font-family="%s" font-size="%s" font-weight="%s" fill="%s" %s>%s</text>' % (fam, size, weight, fill, extra, ts)
def svg_open(theme):
    bg = ('<rect width="960" height="540" fill="%s"/>' % C["mint"] if theme == "mint" else
          '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient></defs>'
          '<rect width="960" height="540" fill="url(#g)"/>' % (C["forest"], C["lift"]))
    lk, mk = (IMG["lockup-forest"], IMG["mark-forest"]) if theme == "mint" else (IMG["lockup-white"], IMG["mark-white"])
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 960 540" width="1920" height="1080">' + STYLE + bg +
            '<image x="23.64" y="24" width="234.45" height="45.91" xlink:href="data:image/png;base64,%s"/>' % lk +
            '<image x="890.34" y="24" width="45.66" height="45.91" xlink:href="data:image/png;base64,%s"/>' % mk)
def caption(theme, text):
    return stext(936, 512, [text], 13.3, "Funnel Sans", 400, C["forest"] if theme == "mint" else C["white"], 0, 'text-anchor="end"')
def eyebrow(theme, text):
    return stext(X, 180, [text], 26.7, "Funnel Sans", 500, C["green"] if theme == "mint" else C["lime"], 0)
def presets_caption(phases): return "presets %s to %s" % (phases[0][0], phases[-1][0])

def svg_setup(eb, title, phases):
    size, lines = fit(title, [56, 48], W, FD, 2)
    out = [svg_open("mint"), eyebrow("mint", eb), stext(X, 205 + size * 0.8, lines, size, "Funnel Display", 500, C["forest"], size * 0.96)]
    y = 205 + len(lines) * size * 0.96 + 40
    for code, name, action in phases:
        tl = wrap(action, 20, 520, FS)
        out.append(stext(X, y + 20, [code], 18, "Funnel Sans", 600, C["green"], 0))
        out.append(stext(165, y + 20, [name], 24, "Funnel Display", 500, C["forest"], 0))
        out.append(stext(400, y + 20, tl, 20, "Funnel Sans", 400, C["forest"], 25))
        h = len(tl) * 25 + 16
        out.append('<line x1="%d" y1="%.1f" x2="920" y2="%.1f" stroke="%s" stroke-width="0.75"/>' % (X, y + h, y + h, C["rule"]))
        y += h + 10
    out += [caption("mint", presets_caption(phases)), "</svg>"]
    return "".join(out)

def svg_lessons(eb, lessons, phases):
    size = 36
    blocks = [wrap(l, size, 760, FD) for l in lessons]
    if sum(len(b) for b in blocks) * size + (len(blocks) - 1) * 28 > 300:
        size = 32; blocks = [wrap(l, size, 760, FD) for l in lessons]
    out = [svg_open("forest"), eyebrow("forest", eb)]
    y = 205 + size * 0.8
    for i, b in enumerate(blocks):
        out.append(stext(X, y, ["%02d" % (i + 1)], 20, "Funnel Sans", 500, C["lime"], 0))
        out.append(stext(160, y, b, size, "Funnel Display", 500, C["white"], size * 1.0))
        y += len(b) * size + 28
    out += [caption("forest", presets_caption(phases)), "</svg>"]
    return "".join(out)

def svg_legend():
    cw, top, h, pad = (903 - 45) / 4, 372, 152, 14.7
    # The line under the title wraps to the content width; the title steps down a size if that line would crowd the cards.
    sub = wrap(LEGEND["sub"], 22, W, FS)
    for size in (56, 48, 44):
        lines, tw = wrap(LEGEND["title"], size, W, FD), W
        while len(wrap(LEGEND["title"], size, tw - 10, FD)) == len(lines): tw -= 10   # balance the lines instead of leaving one word below
        lines = wrap(LEGEND["title"], size, tw, FD)
        y = 205 + len(lines) * size * 0.96 + 30
        if y + (len(sub) - 1) * 27 + 6 <= top - 16: break
    out = [svg_open("mint"), eyebrow("mint", LEGEND["eyebrow"]), stext(X, 205 + size * 0.8, lines, size, "Funnel Display", 500, C["forest"], size * 0.96)]
    out.append(stext(X, y, sub, 22, "Funnel Sans", 400, C["forest"], 27))
    for i, (t, copy) in enumerate(LEGEND["cards"]):
        x = 32.8 + i * (cw + 15)
        out.append('<rect x="%.1f" y="%d" width="%.1f" height="%d" rx="9.3" fill="%s"/>' % (x, top, cw, h, C["forest"]))
        tl = wrap(t, 19, cw - 2 * pad, FD)
        out.append(stext(round(x + pad, 1), top + pad + 16, tl, 19, "Funnel Display", 500, C["lime"], 21))
        out.append(stext(round(x + pad, 1), top + pad + 16 + len(tl) * 21 + 10, wrap(copy, 15, cw - 2 * pad, FS), 15, "Funnel Sans", 500, C["white"], 20.7))
    out += ["</svg>"]
    return "".join(out)

def svg_scenario():
    S, pitch = SCENARIO, 28
    size, lines = fit(S["title"], [48, 44, 40], W, FD, 2)
    out = [svg_open("forest"), eyebrow("forest", S["eyebrow"]), stext(X, 205 + size * 0.8, lines, size, "Funnel Display", 500, C["white"], size * 0.96)]
    y = 205 + len(lines) * size * 0.96 + 32
    out.append(stext(X, y, [S["sub"]], 20, "Funnel Sans", 400, C["frost"], 0))
    # Six one-line rows: part number, the operator, how that part practises it. A hairline under each, as on the setup slides.
    y += 38
    for i, (word, how) in enumerate(S["parts"]):
        out.append(stext(X, y, ["%d" % (i + 1)], 16, "Funnel Sans", 600, C["lime"], 0))
        out.append(stext(X + 28, y, [word], 20, "Funnel Display", 500, C["lime"], 0))
        out.append(stext(X + 160, y, [how], 17, "Funnel Sans", 400, C["white"], 0))
        out.append('<line x1="%d" y1="%.1f" x2="920" y2="%.1f" stroke="%s" stroke-opacity="0.45" stroke-width="0.75"/>' % (X, y + 9, y + 9, C["rule"]))
        y += pitch
    out += ["</svg>"]
    return "".join(out)

def svg_statement():
    S = STATEMENT
    # The artwork stops short of the caption line, so the preset caption does not print on the drawing.
    out = [svg_open("mint"), '<image x="420" y="190" width="540" height="303.9" xlink:href="data:image/png;base64,%s"/>' % ART[S["art"]],
           stext(X, 160, [S["eyebrow"]], 26.7, "Funnel Sans", 500, C["green"], 0),
           stext(X, 242, S["title"].split(), 80, "Funnel Display", 500, C["forest"], 77)]
    y = 242 + (len(S["title"].split()) - 1) * 77 + 42   # first row sits under the last title line, clear of the artwork
    for plane, question in S["planes"]:
        out.append(stext(X, y, [plane], 18, "Funnel Sans", 600, C["green"], 0))
        out.append(stext(X + 128, y, [question], 20, "Funnel Sans", 400, C["forest"], 0))
        y += 27
    out += [caption("mint", S["caption"]), "</svg>"]
    return "".join(out)

def svg_title():
    T = TITLE
    # Title and subtitle, the quote in a column of 620 units, its source under it, and the speaker lines at the foot.
    out = [svg_open("mint"),
           stext(X, 232, [T["title"]], 72, "Funnel Display", 500, C["forest"], 0),
           stext(X, 268, [T["sub"]], 28, "Funnel Sans", 400, C["forest"], 0)]
    q = wrap(T["quote"], 26, 620, FD)
    out.append(stext(X, 330, q, 26, "Funnel Display", 500, C["forest"], 30))
    out.append(stext(X, 330 + len(q) * 30 + 2, [T["source"]], 15, "Funnel Sans", 400, C["green"], 0))
    out.append(stext(X, 472, [T["speaker"][0]], 22, "Funnel Display", 500, C["forest"], 0))
    out.append(stext(X, 496, [T["speaker"][1]], 16, "Funnel Sans", 400, C["forest"], 0))
    out += ["</svg>"]
    return "".join(out)

def svg_recap():
    size, lines = fit(RECAP["title"], [48, 44, 40], W, FD, 3)
    out = [svg_open("forest"), eyebrow("forest", RECAP["eyebrow"]), stext(X, 205 + size * 0.8, lines, size, "Funnel Display", 500, C["white"], size * 0.96)]
    y0 = 205 + len(lines) * size * 0.96 + 44
    for i, item in enumerate(RECAP["items"]):
        col, row = divmod(i, 5)
        x, y = X + col * 420, y0 + row * 30
        out.append(stext(x, y, ["%02d" % (i + 1)], 16, "Funnel Sans", 500, C["lime"], 0))
        out.append(stext(x + 40, y, [item], 18, "Funnel Sans", 400, C["frost"], 0))
    out += ["</svg>"]
    return "".join(out)

# ---------- canvas artboards (.dc.html) ----------
def dc(title, theme, body, code_caption):
    B = BLOBS or {}
    lk, mk = (B.get("lockup-forest", ""), B.get("mark-forest", "")) if theme == "mint" else (B.get("lockup-white", ""), B.get("mark-white", ""))
    bg = "background:%s;color:%s;" % (C["mint"], C["forest"]) if theme == "mint" else "background:linear-gradient(180deg,%s,%s);color:%s;" % (C["forest"], C["lift"], C["white"])
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>%s</title>\n<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n<style>\n'
            '@font-face{font-family:"Funnel Display";src:url(%s) format("woff2");font-weight:300 800}\n'
            '@font-face{font-family:"Funnel Sans";src:url(%s) format("woff2");font-weight:300 800}\n'
            'body{margin:0;font-family:"Funnel Sans",system-ui,sans-serif}\n</style>\n</helmet>\n'
            '<div style="width: 960px; height: 540px; box-sizing: border-box; position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 24px 24px 0 32.8px; font-family: \'Funnel Sans\', system-ui, sans-serif; %s">\n'
            '<div style="display: flex; justify-content: space-between; align-items: flex-start; height: 46px; flex: none;">\n'
            '<img src="%s" alt="AfroTech Conference" style="height: 46px; width: auto; margin-left: -9px;">\n<img src="%s" alt="" style="height: 46px; width: auto;">\n</div>\n'
            '%s\n<div style="position: absolute; right: 24px; bottom: 20px; font-size: 13.3px; line-height: 1.25;">%s</div>\n</div>\n</x-dc>\n'
            '<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":960,"height":540}}\'>\nclass Component extends DCLogic {\n  renderVals() { return {}; }\n}\n</script>\n</body>\n</html>\n'
            % (esc(title), B.get("font-display", ""), B.get("font-sans", ""), bg, lk, mk, body, esc(code_caption)))
def h_eyebrow(theme, t):
    return '<div style="font-size: 26.7px; font-weight: 500; line-height: 1.25; text-transform: uppercase; color: %s;">%s</div>' % (C["green"] if theme == "mint" else C["lime"], esc(t))
def h_title(t, size, color, top=12):
    return '<h1 style="margin: %dpx 0 0; max-width: 809px; font-family: \'Funnel Display\', \'Funnel Sans\', sans-serif; font-weight: 500; font-size: %spx; line-height: 0.96; color: %s;">%s</h1>' % (top, size, color, esc(t))
CONTENT = '<div style="padding: 84px 0 0 78px; display: flex; flex-direction: column;">\n%s\n</div>'

def dc_setup(eb, title, phases):
    size, _ = fit(title, [56, 48], W, FD, 2)
    rows = "".join('<div style="display: grid; grid-template-columns: 54px 235px minmax(0, 1fr); align-items: baseline; padding: 10px 0 12px; border-bottom: 0.75px solid %s;">'
                   '<div style="font-size: 18px; font-weight: 600; color: %s;">%s</div>'
                   '<div style="font-family: \'Funnel Display\', sans-serif; font-weight: 500; font-size: 24px;">%s</div>'
                   '<div style="font-size: 20px; line-height: 1.25;">%s</div></div>\n' % (C["rule"], C["green"], code, esc(name), esc(action)) for code, name, action in phases)
    body = CONTENT % (h_eyebrow("mint", eb) + h_title(title, size, C["forest"]) + '<div style="display: flex; flex-direction: column; margin-top: 30px; max-width: 809px;">\n%s</div>' % rows)
    return dc(eb.title(), "mint", body, presets_caption(phases))
def dc_lessons(eb, lessons, phases):
    size = 36 if sum(len(wrap(l, 36, 760, FD)) for l in lessons) * 36 + (len(lessons) - 1) * 28 <= 300 else 32
    items = "".join('<div style="display: grid; grid-template-columns: 49px minmax(0, 1fr); align-items: baseline;"><div style="font-size: 20px; font-weight: 500; color: %s;">%02d</div>'
                    '<div style="font-family: \'Funnel Display\', sans-serif; font-weight: 500; font-size: %spx; line-height: 1.0; max-width: 760px;">%s</div></div>\n' % (C["lime"], i + 1, size, esc(l)) for i, l in enumerate(lessons))
    body = CONTENT % (h_eyebrow("forest", eb) + '<div style="display: flex; flex-direction: column; gap: 28px; margin-top: 14px;">\n%s</div>' % items)
    return dc(eb.title(), "forest", body, presets_caption(phases))
def dc_legend():
    size, _ = fit(LEGEND["title"], [56, 48], W, FD, 2)
    cards = "".join('<div style="box-sizing: border-box; padding: 14.7px; border-radius: 9.3px; background: %s; display: flex; flex-direction: column; gap: 10px;">'
                    '<div style="font-family: \'Funnel Display\', sans-serif; font-weight: 500; font-size: 19px; line-height: 1.1; color: %s;">%s</div>'
                    '<div style="font-size: 15px; font-weight: 500; line-height: 1.38; color: %s;">%s</div></div>\n' % (C["forest"], C["lime"], esc(t), C["white"], esc(c)) for t, c in LEGEND["cards"])
    body = (CONTENT % (h_eyebrow("mint", LEGEND["eyebrow"]) + h_title(LEGEND["title"], size, C["forest"]) +
            '<div style="margin-top: 20px; font-size: 22px; line-height: 1.25;">%s</div>' % esc(LEGEND["sub"])) +
            '<div style="margin-top: 26px; margin-right: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 15px; height: 152px;">\n%s</div>' % cards)
    return dc("How to read the screen", "mint", body, "")
def dc_scenario():
    S = SCENARIO
    size, _ = fit(S["title"], [48, 44, 40], W, FD, 2)
    rows = "".join('<div style="display: grid; grid-template-columns: 28px 132px minmax(0, 1fr); align-items: baseline; padding: 4px 0 5px; border-bottom: 0.75px solid rgba(149,166,162,0.45);">'
                   '<div style="font-size: 16px; font-weight: 600; color: %s;">%d</div>'
                   '<div style="font-family: \'Funnel Display\', sans-serif; font-weight: 500; font-size: 20px; color: %s;">%s</div>'
                   '<div style="font-size: 17px; color: %s;">%s</div></div>\n' % (C["lime"], i + 1, C["lime"], esc(w), C["white"], esc(h)) for i, (w, h) in enumerate(S["parts"]))
    body = CONTENT % (h_eyebrow("forest", S["eyebrow"]) + h_title(S["title"], size, C["white"]) +
                      '<div style="margin-top: 14px; font-size: 20px; line-height: 1.25; color: %s;">%s</div>' % (C["frost"], esc(S["sub"])) +
                      '<div style="display: flex; flex-direction: column; margin-top: 14px; max-width: 809px;">\n%s</div>' % rows)
    return dc("Project Atlas", "forest", body, "")
def dc_recap():
    size, _ = fit(RECAP["title"], [48, 44, 40], W, FD, 3)
    items = "".join('<div style="display: flex; gap: 0; align-items: baseline;"><div style="width: 40px; flex: none; font-size: 16px; font-weight: 500; color: %s;">%02d</div>'
                    '<div style="font-size: 18px; line-height: 1.25; color: %s;">%s</div></div>\n' % (C["lime"], i + 1, C["frost"], esc(t)) for i, t in enumerate(RECAP["items"]))
    body = CONTENT % (h_eyebrow("forest", RECAP["eyebrow"]) + h_title(RECAP["title"], size, C["white"]) +
                      '<div style="margin-top: 32px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: column; grid-template-rows: repeat(5, 30px); column-gap: 40px;">\n%s</div>' % items)
    return dc("What we learned", "forest", body, "")

# ---------- assemble ----------
slides = [(SCENARIO["stem"], svg_scenario(), dc_scenario(), "Project Atlas"),
          ("06-how-to-read-the-screen", svg_legend(), dc_legend(), "Legend")]
for stem, eb, title, phases, lessons in THEMES:
    slides.append((stem, svg_setup(eb, title, phases), dc_setup(eb, title, phases), eb.title()))
    leb = eb.split(":")[0] + ": WHAT WE LEARNED"
    slides.append((LESSON_STEMS[stem], svg_lessons(leb, lessons, phases), dc_lessons(leb, lessons, phases), leb.title()))
slides.append((STATEMENT["stem"], svg_statement(), None, STATEMENT["title"]))   # svg only: the canvas rows below skip it
slides.append((TITLE["stem"], svg_title(), None, TITLE["title"]))   # svg only
slides.append(("23-recap", svg_recap(), dc_recap(), "Recap"))

for name, svg, _, _ in slides:
    open("%s/%s.svg" % (SLIDES, name), "w").write(svg)
print("wrote %d svg slides" % len(slides))

if BLOBS:
    rows = [("Before the show", ["05-", "06-"]), ("Parts 1 to 3", ["07-", "08-", "09-", "10-", "11-", "12-"]), ("Parts 4 to 6", ["13-", "14-", "15-", "19-", "21-", "22-"]), ("Close", ["23-"])]
    boards, order, notes = {}, [], {}
    for r, (label, prefixes) in enumerate(rows):
        y, x = r * 660, 0
        row = [s for s in slides if any(s[0].startswith(p) for p in prefixes)]
        notes["row%d" % r] = {"x": 0, "y": y - 223, "text": label, "kind": "title1", "maxW": len(row) * 1040 - 80}
        for name, _, html, title in row:
            fn = name + ".dc.html"
            open("%s/project/%s" % (CANVAS, fn), "w").write(html)
            boards[fn] = {"x": x, "y": y, "w": 960, "h": 540, "title": title}
            order.append(fn); x += 1040
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = {"v": 3, "createdOnFiles": {"v": 1, "at": now}, "title": "Context Window Live show slides", "launch": {"view": "canvas"}, "pages": [],
             "boards": boards, "order": order, "notes": notes}
    json.dump(index, open(CANVAS + "/project/canvas.json", "w"), indent=1)
    print("wrote %d artboards" % len(order))
