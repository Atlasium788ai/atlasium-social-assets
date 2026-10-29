from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


OUTPUT = Path(__file__).resolve().parents[1] / "output" / "pdf" / "atlasium-paid-media-fulfilment-overview.pdf"
WIDTH, HEIGHT = letter


def paragraph(canvas, text, x, y, width, style):
    item = Paragraph(text, style)
    _, height = item.wrap(width, HEIGHT)
    item.drawOn(canvas, x, y - height)
    return y - height


def card(canvas, x, y, width, height, title, body, accent):
    canvas.setFillColor(HexColor("#0B1829"))
    canvas.roundRect(x, y - height, width, height, 10, fill=1, stroke=0)
    canvas.setFillColor(accent)
    canvas.roundRect(x, y - height, 4, height, 2, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#F4F8FF"))
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(x + 15, y - 22, title)
    style = ParagraphStyle(
        "card",
        fontName="Helvetica",
        fontSize=8.4,
        leading=12,
        textColor=HexColor("#B8C6D8"),
    )
    paragraph(canvas, body, x + 15, y - 31, width - 29, style)


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(OUTPUT), pagesize=letter, pageCompression=1)
    canvas.setTitle("Atlasium Paid Media Fulfilment Overview")
    canvas.setAuthor("Atlasium 7/88")

    canvas.setFillColor(HexColor("#030914"))
    canvas.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#071728"))
    canvas.circle(WIDTH - 25, HEIGHT + 25, 170, fill=1, stroke=0)
    canvas.setStrokeColor(HexColor("#158FFF"))
    canvas.setLineWidth(1)
    canvas.circle(WIDTH - 25, HEIGHT + 25, 115, fill=0, stroke=1)

    margin = 0.65 * inch
    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(margin, HEIGHT - 48, "ATLASIUM")
    mark_width = stringWidth("ATLASIUM", "Helvetica-Bold", 18)
    canvas.setFillColor(HexColor("#1A95FF"))
    canvas.drawString(margin + mark_width + 7, HEIGHT - 48, "7/88")
    canvas.setFillColor(HexColor("#8194AA"))
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawRightString(WIDTH - margin, HEIGHT - 45, "PAID MEDIA DELIVERY OVERVIEW")

    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont("Helvetica-Bold", 28)
    canvas.drawString(margin, HEIGHT - 105, "Paid media built for")
    canvas.setFillColor(HexColor("#1A95FF"))
    canvas.drawString(margin, HEIGHT - 138, "measurable growth.")

    intro = ParagraphStyle(
        "intro",
        fontName="Helvetica",
        fontSize=10.2,
        leading=15,
        textColor=HexColor("#BCC9D8"),
    )
    paragraph(
        canvas,
        "Atlasium combines commercial strategy, clear reporting, and an approved white-label fulfilment network to plan and operate paid-media programs. Every engagement is scoped to the client's goals, economics, access, and current marketing stack.",
        margin,
        HEIGHT - 159,
        WIDTH - (2 * margin),
        intro,
    )

    canvas.setFillColor(HexColor("#0A2139"))
    canvas.roundRect(margin, HEIGHT - 250, WIDTH - (2 * margin), 48, 10, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#20D7C0"))
    canvas.setFont("Helvetica-Bold", 17)
    canvas.drawString(margin + 17, HEIGHT - 229, "10,000+")
    canvas.setFillColor(HexColor("#F4F8FF"))
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(margin + 110, HEIGHT - 222, "CAMPAIGNS REPORTED BY OUR FULFILMENT PARTNER")
    canvas.setFillColor(HexColor("#8DA1B7"))
    canvas.setFont("Helvetica", 7.6)
    canvas.drawString(margin + 110, HEIGHT - 236, "Partner track record since 2009; scope and team availability are confirmed per engagement.")

    gutter = 12
    card_width = (WIDTH - 2 * margin - gutter) / 2
    top = HEIGHT - 276
    card(canvas, margin, top, card_width, 96, "SEARCH & SOCIAL ADVERTISING",
         "Google Ads, Meta / Facebook / Instagram Ads, and TikTok Ads. Campaign structure, conversion tracking, audience strategy, creative testing, and ongoing optimization are matched to the agreed scope.", HexColor("#188EFF"))
    card(canvas, margin + card_width + gutter, top, card_width, 96, "LEAD ACQUISITION SYSTEM",
         "Landing-page and funnel alignment, lead capture, CRM handoff, qualification logic, appointment booking, and reporting can be included when they support the client's stated objective.", HexColor("#A977FF"))
    top -= 108
    card(canvas, margin, top, card_width, 96, "OPERATING RHYTHM",
         "Discovery and baseline review; implementation plan; tracking validation; controlled launch; optimization against agreed metrics; and concise, decision-ready reporting.", HexColor("#20D7C0"))
    card(canvas, margin + card_width + gutter, top, card_width, 96, "COMMERCIAL DISCIPLINE",
         "Media spend, platform fees, setup work, and management are separated clearly. Forecasts are assumptions, not guarantees. Recommendations are adjusted as verified performance data becomes available.", HexColor("#FFB84D"))

    y = top - 126
    canvas.setFillColor(HexColor("#F4F8FF"))
    canvas.setFont("Helvetica-Bold", 13)
    canvas.drawString(margin, y, "What Atlasium confirms before launch")
    checklist = [
        "Business goal, target audience, geography, offer, and conversion event",
        "Account access, tracking readiness, creative inputs, and approval responsibilities",
        "Media budget, delivery scope, reporting cadence, and success measures",
        "Specialist capacity, dependencies, timeline, and acceptance criteria",
    ]
    canvas.setFont("Helvetica", 8.5)
    for index, line in enumerate(checklist):
        row_y = y - 24 - (index * 21)
        canvas.setFillColor(HexColor("#1A95FF"))
        canvas.circle(margin + 4, row_y + 2, 3, fill=1, stroke=0)
        canvas.setFillColor(HexColor("#C3CFDD"))
        canvas.drawString(margin + 15, row_y, line)

    canvas.setStrokeColor(HexColor("#17314E"))
    canvas.line(margin, 58, WIDTH - margin, 58)
    canvas.setFillColor(HexColor("#8EA1B5"))
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(margin, 39, "Atlasium 7/88 | Intelligent Opportunity, Revenue and Delivery Systems")
    canvas.drawRightString(WIDTH - margin, 39, "Scope-dependent | No performance guarantees")
    canvas.save()


if __name__ == "__main__":
    build()
