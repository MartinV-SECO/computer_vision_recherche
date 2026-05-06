"""Construction de documents DXF (ezdxf)."""

from __future__ import annotations

import io

import ezdxf

# ezdxf écrit du texte ASCII ; StringIO puis encodage en bytes pour la réponse HTTP.


def new_document():
    """Nouveau document R2010."""
    return ezdxf.new("R2010")


def add_polyline_segments(
    msp,
    segments: list[tuple[tuple[float, float, float], tuple[float, float, float]]],
    layer: str,
) -> int:
    """Ajoute des LINE pour chaque segment. Retourne le nombre de segments ajoutés."""
    n = 0
    for p1, p2 in segments:
        msp.add_line(p1, p2, dxfattribs={"layer": layer})
        n += 1
    return n


def ensure_layer(doc, name: str) -> None:
    if name not in doc.layers:
        doc.layers.add(name)


def build_dxf_bytes(
    alpha_segments: list | None,
    ransac_segments: list | None,
) -> bytes:
    """
    alpha_segments / ransac_segments : listes de ((x1,y1,z1),(x2,y2,z2)) ou None.
    """
    doc = new_document()
    ensure_layer(doc, "ALPHA_SHAPE")
    ensure_layer(doc, "RANSAC")
    msp = doc.modelspace()
    if alpha_segments:
        add_polyline_segments(msp, alpha_segments, "ALPHA_SHAPE")
    if ransac_segments:
        add_polyline_segments(msp, ransac_segments, "RANSAC")
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("latin-1", errors="replace")
