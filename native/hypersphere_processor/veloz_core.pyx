# veloz_core.pyx
# Version en Cython de un calculo simple (producto punto / similitud coseno
# entre un vector y un banco de vectores), para comparar contra la version
# en Python puro y contra numpy vectorizado.
#
# Las anotaciones de tipo (double[:, :], double[:], etc.) son lo que le
# permite a Cython generar codigo C real en vez de bytecode de Python.

import numpy as np
cimport numpy as np
cimport cython

@cython.boundscheck(False)  # desactiva chequeos de rango (mas rapido, ya validamos a mano)
@cython.wraparound(False)
def similitudes_cython(double[:, :] banco, double[:] consulta):
    """
    banco: matriz (n, dim) de vectores YA normalizados
    consulta: vector (dim,) YA normalizado
    Devuelve: arreglo (n,) con la similitud coseno (producto punto) de la
    consulta contra cada fila del banco.
    """
    cdef int n = banco.shape[0]
    cdef int dim = banco.shape[1]
    cdef int i, j
    cdef double acumulado
    cdef np.ndarray[np.double_t, ndim=1] resultado = np.zeros(n, dtype=np.double)

    for i in range(n):
        acumulado = 0.0
        for j in range(dim):
            acumulado += banco[i, j] * consulta[j]
        resultado[i] = acumulado

    return resultado
