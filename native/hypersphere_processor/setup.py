# setup.py
# Corre esto en la TERMINAL de Pydroid3 (no con el boton Play):
#     python setup.py build_ext --inplace
#
# Eso compila veloz_core.pyx -> veloz_core.c -> veloz_core.so
# usando el compilador C que Pydroid3 trae integrado.

from setuptools import setup
from Cython.Build import cythonize
import numpy

setup(
    ext_modules=cythonize(["veloz_core.pyx", "hnsw_core.pyx"], language_level=3),
    include_dirs=[numpy.get_include()],
)
