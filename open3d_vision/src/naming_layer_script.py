import ezdxf
import pandas as pd
import numpy as np

doc = ezdxf.readfile(r"C:\Users\mvm\open3d_vision\data\25-GO1837-CAD-1 ind A_new.dxf")
msp = doc.modelspace()

rows = []

for e in msp:
    row = {
        "entity_type": e.dxftype(),
        "handle": e.dxf.handle
    }

    # Récupère TOUS les attributs DXF existants pour l'entité
    for key, value in e.dxfattribs().items():
        row[key] = value

    rows.append(row)

df = pd.DataFrame(rows)

def rename_layer(name,new_name, dataframe):
    layer_list = dataframe["layer"].unique()
    if name in layer_list:
        dataframe.loc[dataframe["layer"] == name, "layer"] = new_name
    return dataframe

if(__name__ == "__main__"):
    rename_layer(name="MUR PORTEUR", new_name="TEST", dataframe=df)

    doc.saveas(r"C:\Users\mvm\open3d_vision\data\25-GO1837-CAD-1 ind A_new_renamed.dxf")