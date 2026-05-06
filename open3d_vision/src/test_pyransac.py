import pyransac
from pyransac import line2d

# Create data
inliers = [line2d.Point2D(x, x) for x in range(0, 10)]
outliers = [line2d.Point2D(x ** 2, x + 10) for x in range(0, 5)]
data = inliers + outliers

# Specify our RANSAC parameters
params = pyransac.RansacParams(samples=2,
                              iterations=10,
                              confidence=0.999,
                             threshold=1)
# Create our model object
model = line2d.Line2D()

# Get the inliers
inliers = pyransac.find_inliers(points=data,
                               model=model,
                                params=params)

print(data)
print(inliers)