from pathlib import Path
import shutil

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "EchoFlow-Assistant-Quick-Guide.pdf"
PUBLIC = ROOT / "public" / "EchoFlow-Assistant-Quick-Guide.pdf"

INK = HexColor("#17150F")
MUTED = HexColor("#675F51")
GOLD = HexColor("#B9892F")
PALE = HexColor("#F8F3E8")
LINE = HexColor("#D9CBAE")
GREEN = HexColor("#317A55")


def paragraph(pdf, text, x, y_top, width, style, max_height=200):
    item = Paragraph(text, style)
    _, height = item.wrap(width, max_height)
    item.drawOn(pdf, x, y_top - height)
    return height


def section(pdf, title, items, x, y_top, width, number=None):
    if number:
        pdf.setFillColor(GOLD)
        pdf.roundRect(x, y_top - 18, 18, 18, 4, fill=1, stroke=0)
        pdf.setFillColor(HexColor("#FFFFFF"))
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawCentredString(x + 9, y_top - 13, str(number))
        title_x = x + 26
    else:
        title_x = x
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(title_x, y_top - 14, title)
    y = y_top - 30
    body = ParagraphStyle(
        "body",
        fontName="Helvetica",
        fontSize=8.3,
        leading=11.1,
        textColor=INK,
        bulletIndent=0,
        leftIndent=11,
        spaceAfter=2,
    )
    for item in items:
        height = paragraph(pdf, f"- {item}", x, y, width, body)
        y -= height + 2
    return y


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)

    pdf = canvas.Canvas(str(OUTPUT), pagesize=letter)
    page_w, page_h = letter
    margin = 0.55 * inch
    content_w = page_w - 2 * margin

    pdf.setTitle("EchoFlow Assistant Quick Guide - Phase 1: FLOW")
    pdf.setAuthor("Atlasium 7/88 AI")
    pdf.setSubject("One-page FLOW monitoring guide for EchoFlow Social")

    pdf.setFillColor(HexColor("#0D0C09"))
    pdf.rect(0, page_h - 1.42 * inch, page_w, 1.42 * inch, fill=1, stroke=0)
    pdf.setFillColor(GOLD)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(margin, page_h - 0.42 * inch, "ATLASIUM 7/88 AI")
    pdf.setFillColor(HexColor("#FFFFFF"))
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(margin, page_h - 0.78 * inch, "Phase 1: FLOW Quick Guide")
    pdf.setFillColor(HexColor("#D9CBAE"))
    pdf.setFont("Helvetica", 9)
    pdf.drawString(margin, page_h - 1.05 * inch, "Your first job: check channels, scheduled posts, and delivery results.")

    login_y = page_h - 1.68 * inch
    pdf.setFillColor(PALE)
    pdf.setStrokeColor(LINE)
    pdf.roundRect(margin, login_y - 0.78 * inch, content_w, 0.78 * inch, 8, fill=1, stroke=1)
    pdf.setFillColor(GREEN)
    pdf.setFont("Helvetica-Bold", 10)
    pdf.drawString(margin + 14, login_y - 18, "LOGIN")
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(margin + 14, login_y - 36, "Site:")
    url = "atlasium-image-uploader.statusx22.chatgpt.site/flow/activity"
    pdf.setFont("Helvetica", 8.2)
    pdf.drawString(margin + 42, login_y - 36, url)
    pdf.linkURL(f"https://{url}", (margin + 42, login_y - 39, margin + 42 + stringWidth(url, "Helvetica", 8.2), login_y - 29), relative=0)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(margin + 14, login_y - 53, "Email:")
    pdf.setFont("Helvetica", 8.5)
    pdf.drawString(margin + 48, login_y - 53, "info@atlasium788.ca")
    pdf.setFillColor(MUTED)
    pdf.drawRightString(page_w - margin - 14, login_y - 53, "Use the password provided by Blair. Never share it.")

    col_gap = 0.34 * inch
    col_w = (content_w - col_gap) / 2
    left_x = margin
    right_x = margin + col_w + col_gap
    top = login_y - 1.02 * inch

    y_left = section(pdf, "Open FLOW", [
        "Sign in, then choose FLOW from the top menu.",
        "Choose the correct brand from the brand menu.",
        "Channels: confirm the right Buffer accounts say Connected.",
        "Queue: see posts waiting to publish.",
        "Calendar: see when posts are scheduled.",
        "Activity: see what was sent or failed.",
    ], left_x, top, col_w, 1)

    y_left = section(pdf, "Daily check - 5 minutes", [
        "Open Activity and press Refresh once.",
        "Confirm today's posts are Sent or still Scheduled.",
        "Open failed items and note the brand, channel, and time.",
        "If a live-post link appears, open it for a quick visual check.",
    ], left_x, y_left - 12, col_w, 2)

    y_right = section(pdf, "What the statuses mean", [
        "Connected: Buffer account is available.",
        "Confirmed or Scheduled: Buffer accepted it and it is waiting.",
        "Sent: Buffer reports that the post published.",
        "Failed: the post needs attention.",
        "Pending: wait, then press Refresh once.",
    ], right_x, top, col_w)

    y_right = section(pdf, "If something goes wrong", [
        "Press Refresh once. Do not keep clicking.",
        "If it failed, take one screenshot of the full error.",
        "Send the screenshot, brand name, and time to Blair.",
        "Do not disconnect channels or change brand settings.",
        "FLOW is read-only. It does not create, edit, cancel, or publish posts.",
    ], right_x, y_right - 12, col_w)

    bottom_y = min(y_left, y_right) - 12
    pdf.setFillColor(PALE)
    pdf.setStrokeColor(LINE)
    pdf.roundRect(margin, bottom_y - 46, content_w, 46, 7, fill=1, stroke=1)
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 9.5)
    pdf.drawString(margin + 14, bottom_y - 17, "Before you leave")
    pdf.setFont("Helvetica", 8.2)
    pdf.drawString(margin + 14, bottom_y - 33, "Confirm there are no unexplained Failed items, then use Sign out in the top-right corner.")

    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 7)
    pdf.drawString(margin, 0.34 * inch, "EchoFlow Social - Internal use - Updated September 2026")
    pdf.drawRightString(page_w - margin, 0.34 * inch, "Phase 1 - FLOW monitoring only")
    pdf.save()
    shutil.copyfile(OUTPUT, PUBLIC)


if __name__ == "__main__":
    build()
