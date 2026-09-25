# hnsw_core.pyx
# Acelera la funcion que HNSW llama miles de veces por insercion:
# la similitud (producto punto) entre dos vectores. np.dot(a, b) tiene
# overhead de Python/numpy en CADA llamada (creacion de objetos,
# chequeos de tipo). Cuando se llama miles de veces por insercion,
# ese overhead repetido es justo lo que estaba haciendo lenta la
# construccion del grafo. Esta version compila a un bucle C plano,
# sin ese overhead.

cimport cython

@cython.boundscheck(False)
@cython.wraparound(False)
@cython.cdivision(True)
cpdef double similitud(double[:] a, double[:] b) nogil:
    cdef int i
    cdef int n = a.shape[0]
    cdef double acumulado = 0.0
    for i in range(n):
        acumulado += a[i] * b[i]
    return acumulado
