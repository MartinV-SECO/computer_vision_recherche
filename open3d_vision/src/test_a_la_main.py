"""
Diagnostic : affiche quel Python est utilisé et les premiers chemins de recherche.
Si ce n'est pas le .venv du projet, sélectionnez l'interpréteur du venv dans Cursor
(Palette de commandes > "Python: Select Interpreter" > .venv).
"""
import sys
print("Python utilisé:", sys.executable)
print("Premiers chemins:", sys.path[:3])

import matplotlib
matplotlib.use('tkAgg')
from matplotlib import pyplot as plt
from PIL import Image
import torch
from transformers import GLPNImageProcessor, GLPNForDepthEstimation
import numpy as np
import open3d as o3d

feature_extractor = GLPNImageProcessor.from_pretrained("vinvino02/glpn-nyu")
model = GLPNForDepthEstimation.from_pretrained("vinvino02/glpn-nyu")