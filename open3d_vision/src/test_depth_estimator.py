import sys
print("Python utilisé:", sys.executable)
print("Premiers chemins:", sys.path[:3])

import matplotlib
matplotlib.use('tkAgg')
from matplotlib import pyplot as plt
from PIL import Image
import torch
import numpy as np
import open3d as o3d
import requests
import dataclasses
from pathlib import Path
import depth_pro
from depth_pro.depth_pro import create_model_and_transforms, DEFAULT_MONODEPTH_CONFIG_DICT


def revert_depth_image(depth_image):
    """
    Inverse la profondeur de l'image : proche <-> lointain.
    depth_image : array numpy 2D (H, W), valeurs de profondeur.
    Retourne une copie avec depth_inv = depth_max - depth + depth_min (range préservé, ordre inversé).
    """
    d = np.asarray(depth_image, dtype=np.float64)
    d_min, d_max = d.min(), d.max()
    return (d_max - d + d_min).astype(depth_image.dtype if hasattr(depth_image, 'dtype') else np.float32)


IMAGE_PATH = r"C:\Users\mvm\open3d_vision\data\pile-of-soil-top-view-isolated-on-white-G1N4P8.jpg"

CHECKPOINT = Path(r"C:\Users\mvm\open3d_vision\ml-depth-pro\checkpoints\depth_pro_alt.pt")
config = dataclasses.replace(DEFAULT_MONODEPTH_CONFIG_DICT, checkpoint_uri=str(CHECKPOINT))
model, transform = create_model_and_transforms(config=config)
model.eval()

image_og, _, f_px = depth_pro.load_rgb(r"C:\Users\mvm\open3d_vision\data\pile-of-soil-top-view-isolated-on-white-G1N4P8_2.jpg")
image = transform(image_og)
prediction = model.infer(image, f_px=f_px)
depth = prediction["depth"].squeeze().cpu().numpy()  # en mètres, numpy pour revert_depth_image()
from transformers import GLPNImageProcessor, GLPNForDepthEstimation
IMAGE_PATH = r"C:\Users\mvm\open3d_vision\data\pile-of-soil-top-view-isolated-on-white-G1N4P8_2.jpg"
image = Image.open(IMAGE_PATH).convert("RGB")
feature_extractor = GLPNImageProcessor.from_pretrained("vinvino02/glpn-nyu")
model = GLPNForDepthEstimation.from_pretrained("vinvino02/glpn-nyu")
inputs = feature_extractor(images=image, return_tensors='pt')
with torch.no_grad():
    outputs = model(**inputs)
    predicted_depth = outputs.predicted_depth
pad = 16
depth_array = predicted_depth.squeeze().cpu().numpy() * 1000.0
depth_array = depth_array[pad:-pad, pad:-pad]
image_cropped = image.crop((pad, pad, image.width - pad, image.height - pad))
depth = revert_depth_image(depth)
fig, ax = plt.subplots(1, 2)
ax[0].imshow(image_cropped)
ax[0].set_title("Image rognee")
ax[1].imshow(depth, cmap='plasma')
ax[1].set_title("Profondeur GLPN")
ax[0].tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)
ax[1].tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)
plt.tight_layout()
plt.show()
print("a")