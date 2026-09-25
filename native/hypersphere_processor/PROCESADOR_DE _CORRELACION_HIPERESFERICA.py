"""
PROCESADOR DE CORRELACION HIPERESFERICA (version corregida y real)
====================================================================
Esto NO es un procesador de hardware. Es un modulo de software real,
medible, que puedes integrar en un motor grafico.

CORRECCION HONESTA DE LA TEORIA ORIGINAL:
------------------------------------------
El documento original hablaba de variedades de Calabi-Yau, energia
protegida topologicamente y velocidad de correlacion mayor a la luz.
Nada de eso es fisica real ni computable. Pero la INTUICION de fondo
("dos cosas pueden estar lejos en el espacio pero cerca en una
geometria interna que importa mas para el problema") SI tiene una
version matematica real y muy usada:

    Locality-Sensitive Hashing (LSH) sobre una hiperesfera unitaria.

Es el fundamento real de: busqueda aproximada de vecinos cercanos en
espacios de alta dimension (embeddings de imagenes/texturas, motores
de recomendacion, bases de datos vectoriales, sintesis de texturas,
fotones en iluminacion global, animation matching).

QUE HACE ESTE CODIGO:
----------------------
1. Un "procesador" LSH que indexa vectores normalizados (puntos en una
   hiperesfera S^(d-1)) usando hiperplanos aleatorios como funcion hash.
2. Una consulta de vecinos "topologicamente cercanos" (alta correlacion
   coseno) en tiempo sub-lineal en vez de O(n).
3. Un benchmark real: fuerza bruta vs. este metodo, con tiempos y
   calidad (recall) medidos, no inventados.
4. Un caso de uso de motor grafico: banco de "parches de textura"
   (como en algoritmos reales de sintesis/inpainting de texturas) y
   busqueda del parche mas parecido para rellenar un hueco.

Solo usa numpy. Corre en Pydroid3 sin dependencias graficas.
"""

import time
import math
import heapq
import numpy as np

try:
    from hnsw_core import similitud as _similitud_cython
    HAY_CYTHON = True
except ImportError:
    HAY_CYTHON = False


class ProcesadorDeCorrelacionHiperesferica:
    """
    'Procesador' de busqueda por correlacion (coseno) usando LSH con
    MULTI-PROBE (Lv et al., 2007) e indexado vectorizado.

    Mejoras reales sobre la version anterior:
    1. Indexado vectorizado: se hashean TODOS los vectores de un lote
       con una sola multiplicacion de matrices por tabla, en vez de un
       bucle en Python por cada vector uno a una. Elimina el cuello de
       botella que viste en tu prueba (5.3s de indexado).
    2. Multi-probe: ademas del cubo (bucket) donde cae el vector,
       tambien revisa los cubos vecinos mas probables -- los que se
       obtienen volteando los bits del hash que estaban mas cerca del
       limite de decision (mas "inciertos"). Esto permite usar MENOS
       tablas hash (menos memoria, insercion mas rapida) sin perder
       calidad de busqueda. Es una tecnica real y publicada, no
       inventada: "Multi-Probe LSH: Efficient Indexing for High-
       Dimensional Similarity Search" (Lv, Josephson, Wang, Charikar,
       Li - VLDB 2007).
    """

    def __init__(self, dim, n_bits=10, n_tablas=5, n_probes=6, semilla=0):
        self.dim = dim
        self.n_bits = n_bits
        self.n_tablas = n_tablas
        self.n_probes = n_probes
        rng = np.random.default_rng(semilla)
        self.hiperplanos = [rng.normal(size=(n_bits, dim)) for _ in range(n_tablas)]
        self.potencias = (1 << np.arange(n_bits - 1, -1, -1)).astype(np.int64)
        self.tablas = [dict() for _ in range(n_tablas)]
        self.vectores = {}

    def insertar_lote(self, ids, vectores):
        """Indexa muchos vectores de una vez (vectorizado, sin bucle por vector)."""
        V = np.asarray(vectores, dtype=float)
        V = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-12)
        for i, id_ in enumerate(ids):
            self.vectores[id_] = V[i]
        for t in range(self.n_tablas):
            proyecciones = V @ self.hiperplanos[t].T          # (n, n_bits), una sola multiplicacion
            bits = (proyecciones >= 0).astype(np.int64)
            codigos = bits @ self.potencias                   # (n,) codigo de cubo para cada vector
            tabla = self.tablas[t]
            for i, id_ in enumerate(ids):
                tabla.setdefault(int(codigos[i]), []).append(id_)

    def insertar(self, id_, vector):
        self.insertar_lote([id_], [vector])

    def _candidatos_multiprobe(self, v):
        candidatos = set()
        for t in range(self.n_tablas):
            proy = self.hiperplanos[t] @ v                    # (n_bits,)
            bits = (proy >= 0).astype(np.int64)
            codigo_base = int(np.dot(bits, self.potencias))
            candidatos.update(self.tablas[t].get(codigo_base, ()))

            # Multi-probe: voltear, de a uno, los bits mas "inciertos"
            # (cuya proyeccion estuvo mas cerca de 0, es decir, el vector
            # pudo haber caido del otro lado de ese hiperplano con muy
            # poco cambio). Se revisan esos cubos vecinos tambien.
            confianza = np.abs(proy)
            orden = np.argsort(confianza)[:self.n_probes]
            for b in orden:
                codigo_vecino = codigo_base ^ int(self.potencias[b])
                candidatos.update(self.tablas[t].get(codigo_vecino, ()))
        return candidatos

    def consultar(self, vector, k=8):
        v = np.asarray(vector, dtype=float)
        v = v / (np.linalg.norm(v) + 1e-12)
        candidatos = self._candidatos_multiprobe(v)
        if not candidatos:
            candidatos = set(self.vectores.keys())
        candidatos = list(candidatos)
        M = np.stack([self.vectores[c] for c in candidatos])
        sims = M @ v
        orden = np.argsort(-sims)[:k]
        return [(candidatos[i], float(sims[i])) for i in orden]

    def consultar_fuerza_bruta(self, vector, k=8):
        """Version exacta (O(n)), solo para comparar calidad y velocidad."""
        v = np.asarray(vector, dtype=float)
        v = v / (np.linalg.norm(v) + 1e-12)
        ids = list(self.vectores.keys())
        M = np.stack([self.vectores[i] for i in ids])
        sims = M @ v
        orden = np.argsort(-sims)[:k]
        return [(ids[i], float(sims[i])) for i in orden]

    def memoria_estimada_bytes(self):
        """Cuanta memoria ocupan las tablas hash (para comparar con la version anterior)."""
        total = 0
        for tabla in self.tablas:
            for lista in tabla.values():
                total += 28 * len(lista)  # aprox. 28 bytes por entrada de lista en Python
        return total


# ---------------------------------------------------------------------
# CASO DE USO: banco de "parches de textura" para un motor grafico
# ---------------------------------------------------------------------

def generar_banco_de_parches(n_parches, dim, n_familias=25, semilla=1):
    """
    Simula descriptores de parches de textura (como los que usan
    algoritmos reales de sintesis de texturas / inpainting): vectores
    de caracteristicas agrupados en 'familias' (tipos de textura:
    piedra, madera, tela, etc.), con variacion dentro de cada familia.
    """
    rng = np.random.default_rng(semilla)
    centros = rng.normal(size=(n_familias, dim))
    centros /= np.linalg.norm(centros, axis=1, keepdims=True)

    familia_de = rng.integers(0, n_familias, size=n_parches)
    ruido = rng.normal(scale=0.08, size=(n_parches, dim))
    parches = centros[familia_de] + ruido
    parches /= np.linalg.norm(parches, axis=1, keepdims=True)
    return parches, familia_de, centros


def benchmark(n_parches=20000, dim=64, n_consultas=200, k=8):
    print("=" * 66)
    print("BENCHMARK: Procesador de correlacion hiperesferica (LSH) vs fuerza bruta")
    print("=" * 66)
    print(f"Banco de parches: {n_parches} vectores en dimension {dim}")

    parches, familia_de, _ = generar_banco_de_parches(n_parches, dim)

    proc = ProcesadorDeCorrelacionHiperesferica(dim=dim, n_bits=10, n_tablas=5, n_probes=6)
    t0 = time.perf_counter()
    proc.insertar_lote(list(range(n_parches)), parches)
    t_indexado = time.perf_counter() - t0
    print(f"Tiempo de indexado de {n_parches} parches (vectorizado): {t_indexado:.3f} s")
    print(f"Memoria estimada de las tablas hash: {proc.memoria_estimada_bytes()/1024:.1f} KB "
          f"(con {proc.n_tablas} tablas, antes se usaban 20)")

    rng = np.random.default_rng(99)
    consultas_idx = rng.integers(0, n_parches, size=n_consultas)

    # --- fuerza bruta ---
    t0 = time.perf_counter()
    resultados_bruta = [proc.consultar_fuerza_bruta(parches[i], k=k) for i in consultas_idx]
    t_bruta = time.perf_counter() - t0

    # --- LSH (nuestro "procesador") ---
    t0 = time.perf_counter()
    resultados_lsh = [proc.consultar(parches[i], k=k) for i in consultas_idx]
    t_lsh = time.perf_counter() - t0

    # --- calidad: cuanto se parece el resultado LSH al exacto (recall) ---
    aciertos = 0
    total = 0
    for r_exacto, r_lsh in zip(resultados_bruta, resultados_lsh):
        ids_exactos = set(i for i, _ in r_exacto)
        ids_lsh = set(i for i, _ in r_lsh)
        aciertos += len(ids_exactos & ids_lsh)
        total += len(ids_exactos)
    recall = aciertos / total if total else 0.0

    print(f"\n{n_consultas} consultas de top-{k} vecinos mas correlacionados:")
    print(f"  Fuerza bruta (exacto):        {t_bruta*1000:.1f} ms totales  "
          f"({t_bruta/n_consultas*1000:.3f} ms/consulta)")
    print(f"  Procesador LSH (aproximado):  {t_lsh*1000:.1f} ms totales  "
          f"({t_lsh/n_consultas*1000:.3f} ms/consulta)")
    if t_lsh > 0:
        print(f"  Aceleracion: {t_bruta/t_lsh:.1f}x mas rapido")
    print(f"  Calidad (recall vs. resultado exacto): {recall*100:.1f}%")

    return proc, parches, familia_de


def demo_inpainting(proc, parches, familia_de, k=5):
    """
    Simula el caso real de un motor grafico: un parche de textura esta
    'danado' (ruido, hueco) y hay que encontrar el parche mas parecido
    del banco para rellenarlo (sintesis de texturas / inpainting).
    """
    print("\n" + "=" * 66)
    print("CASO DE USO: relleno de textura (inpainting) via correlacion")
    print("=" * 66)
    rng = np.random.default_rng(7)
    idx_original = rng.integers(0, len(parches))
    original = parches[idx_original]
    danado = original + rng.normal(scale=0.15, size=original.shape)  # simular dano/ruido moderado

    vecinos = proc.consultar(danado, k=k)
    print(f"Parche danado (familia real={familia_de[idx_original]}). "
          f"Buscando los {k} parches mas correlacionados para rellenarlo...\n")
    for i, (id_, sim) in enumerate(vecinos, 1):
        print(f"  #{i}: parche {id_:>6}  familia={familia_de[id_]:>2}  correlacion={sim:+.3f}")

    familias_encontradas = [familia_de[id_] for id_, _ in vecinos]
    acierto = familias_encontradas.count(familia_de[idx_original]) / len(familias_encontradas)
    print(f"\n{acierto*100:.0f}% de los candidatos encontrados son de la familia de textura correcta.")


# ---------------------------------------------------------------------
# EL SIGUIENTE PASO MATEMATICO: HNSW (grafos navegables jerarquicos)
# ---------------------------------------------------------------------
# Referencia real: Malkov & Yashunin, "Efficient and robust approximate
# nearest neighbor search using Hierarchical Navigable Small World
# graphs" (IEEE TPAMI 2018). Es el algoritmo detras de FAISS, Milvus,
# Qdrant y la mayoria de bases de datos vectoriales en produccion.
#
# Idea matematica (teoria de grafos de "mundo pequeno", Watts-Strogatz):
# en vez de cubos hash, se construye un grafo en capas. La capa superior
# tiene pocos nodos con conexiones "de largo alcance" (saltos grandes);
# las capas inferiores tienen mas nodos con conexiones locales finas.
# Buscar es "descender" por las capas: saltos grandes primero para
# acercarse rapido a la zona correcta, luego saltos finos para precision.
# Es la misma logica de "seis grados de separacion".

class HNSWLite:
    def __init__(self, dim, M=12, ef_construction=80, semilla=0):
        self.dim = dim
        self.M = M                          # conexiones por nodo en capas > 0
        self.M_max0 = M * 2                 # la capa 0 admite mas conexiones (mas densa)
        self.ef_construction = ef_construction
        self.mL = 1.0 / math.log(M)         # controla que tan rapido decae la altura de las capas
        self.rng = np.random.default_rng(semilla)
        self.vectores = {}
        self.grafo = []                     # grafo[nivel] = {id: set(vecinos)}
        self.punto_entrada = None
        self.nivel_maximo = -1

    def _sim(self, a, b):
        if HAY_CYTHON:
            return _similitud_cython(a, b)           # bucle C plano, sin overhead por llamada
        return float(np.dot(a, b))                    # respaldo si no se compilo Cython todavia

    def _nivel_aleatorio(self):
        return int(-math.log(self.rng.random()) * self.mL)

    def _buscar_capa(self, q, puntos_entrada, ef, nivel):
        """Busqueda greedy con lista de candidatos de tamano dinamico ef."""
        visitados = set(puntos_entrada)
        candidatos = [(-self._sim(q, self.vectores[p]), p) for p in puntos_entrada]
        heapq.heapify(candidatos)
        resultado = [(-s, p) for s, p in candidatos]
        heapq.heapify(resultado)  # min-heap: el peor resultado actual queda arriba
        while candidatos:
            sim_neg, actual = heapq.heappop(candidatos)
            sim_actual = -sim_neg
            peor = resultado[0][0] if resultado else -1e9
            if sim_actual < peor and len(resultado) >= ef:
                break
            for vecino in self.grafo[nivel].get(actual, ()):
                if vecino in visitados:
                    continue
                visitados.add(vecino)
                sim_v = self._sim(q, self.vectores[vecino])
                peor = resultado[0][0] if resultado else -1e9
                if len(resultado) < ef or sim_v > peor:
                    heapq.heappush(candidatos, (-sim_v, vecino))
                    heapq.heappush(resultado, (sim_v, vecino))
                    if len(resultado) > ef:
                        heapq.heappop(resultado)
        return resultado  # lista de (similitud, id)

    def insertar(self, id_, vector):
        v = np.asarray(vector, dtype=float)
        v = v / (np.linalg.norm(v) + 1e-12)
        self.vectores[id_] = v
        nivel_nodo = self._nivel_aleatorio()
        while len(self.grafo) <= nivel_nodo:
            self.grafo.append({})

        if self.punto_entrada is None:
            self.punto_entrada = id_
            self.nivel_maximo = nivel_nodo
            for L in range(nivel_nodo + 1):
                self.grafo[L][id_] = set()
            return

        actual = self.punto_entrada
        for nivel in range(self.nivel_maximo, nivel_nodo, -1):
            resultado = self._buscar_capa(v, [actual], ef=1, nivel=nivel)
            if resultado:
                actual = max(resultado)[1]

        entrada = [actual]
        for nivel in range(min(nivel_nodo, self.nivel_maximo), -1, -1):
            resultado = self._buscar_capa(v, entrada, ef=self.ef_construction, nivel=nivel)
            elegidos = sorted(resultado, reverse=True)[:self.M]
            self.grafo[nivel].setdefault(id_, set())
            for sim, vecino in elegidos:
                self.grafo[nivel][id_].add(vecino)
                self.grafo[nivel].setdefault(vecino, set()).add(id_)
                maximo = self.M_max0 if nivel == 0 else self.M
                if len(self.grafo[nivel][vecino]) > maximo:
                    vecinos_v = list(self.grafo[nivel][vecino])
                    sims = sorted(
                        ((self._sim(self.vectores[vecino], self.vectores[w]), w) for w in vecinos_v),
                        reverse=True,
                    )
                    self.grafo[nivel][vecino] = set(w for _, w in sims[:maximo])
            entrada = [vecino for _, vecino in elegidos] or entrada

        if nivel_nodo > self.nivel_maximo:
            self.nivel_maximo = nivel_nodo
            self.punto_entrada = id_

    def consultar(self, vector, k=8, ef_search=50):
        v = np.asarray(vector, dtype=float)
        v = v / (np.linalg.norm(v) + 1e-12)
        if self.punto_entrada is None:
            return []
        actual = self.punto_entrada
        for nivel in range(self.nivel_maximo, 0, -1):
            resultado = self._buscar_capa(v, [actual], ef=1, nivel=nivel)
            if resultado:
                actual = max(resultado)[1]
        resultado = self._buscar_capa(v, [actual], ef=max(ef_search, k), nivel=0)
        resultado.sort(reverse=True)
        return [(id_, sim) for sim, id_ in resultado[:k]]


def benchmark_hnsw(n_parches=5000, dim=64, n_consultas=200, k=8):
    """
    HNSW se inserta nodo por nodo (no se puede vectorizar por lotes como
    el LSH, porque cada insercion depende del grafo ya construido), asi
    que se prueba con un banco un poco mas chico para que el indexado no
    tarde demasiado en un telefono.
    """
    print("\n" + "=" * 66)
    print("SIGUIENTE PASO: HNSW (grafo navegable jerarquico) vs LSH vs fuerza bruta")
    print("=" * 66)
    print(f"Aceleracion Cython para la similitud interna de HNSW: "
          f"{'ACTIVA (.so compilado encontrado)' if HAY_CYTHON else 'INACTIVA (usando numpy de respaldo)'}")
    print(f"Banco de parches: {n_parches} vectores en dimension {dim}")

    parches, familia_de, _ = generar_banco_de_parches(n_parches, dim)

    # --- indexar en HNSW ---
    hnsw = HNSWLite(dim=dim, M=12, ef_construction=80)
    t0 = time.perf_counter()
    for i in range(n_parches):
        hnsw.insertar(i, parches[i])
    t_indexado_hnsw = time.perf_counter() - t0
    print(f"Tiempo de indexado HNSW: {t_indexado_hnsw:.3f} s")

    # --- indexar en LSH multi-probe (para comparar en igualdad de condiciones) ---
    lsh = ProcesadorDeCorrelacionHiperesferica(dim=dim, n_bits=10, n_tablas=5, n_probes=6)
    t0 = time.perf_counter()
    lsh.insertar_lote(list(range(n_parches)), parches)
    t_indexado_lsh = time.perf_counter() - t0
    print(f"Tiempo de indexado LSH multi-probe: {t_indexado_lsh:.3f} s")

    rng = np.random.default_rng(99)
    consultas_idx = rng.integers(0, n_parches, size=n_consultas)

    def medir(nombre, funcion_consulta):
        t0 = time.perf_counter()
        resultados = [funcion_consulta(parches[i]) for i in consultas_idx]
        t = time.perf_counter() - t0
        return resultados, t

    resultados_bruta, t_bruta = medir("bruta", lambda v: lsh.consultar_fuerza_bruta(v, k=k))
    resultados_lsh, t_lsh = medir("lsh", lambda v: lsh.consultar(v, k=k))
    resultados_hnsw, t_hnsw = medir("hnsw", lambda v: hnsw.consultar(v, k=k, ef_search=50))

    def recall(exactos, aproximados):
        aciertos = total = 0
        for e, a in zip(exactos, aproximados):
            ids_e = set(i for i, _ in e)
            ids_a = set(i for i, _ in a)
            aciertos += len(ids_e & ids_a)
            total += len(ids_e)
        return aciertos / total if total else 0.0

    recall_lsh = recall(resultados_bruta, resultados_lsh)
    recall_hnsw = recall(resultados_bruta, resultados_hnsw)

    print(f"\n{n_consultas} consultas de top-{k}:")
    print(f"  Fuerza bruta (exacto):  {t_bruta*1000:8.1f} ms totales  ({t_bruta/n_consultas*1000:.3f} ms/consulta)")
    print(f"  LSH multi-probe:        {t_lsh*1000:8.1f} ms totales  ({t_lsh/n_consultas*1000:.3f} ms/consulta)"
          f"   recall={recall_lsh*100:.1f}%   aceleracion={t_bruta/t_lsh:.1f}x")
    print(f"  HNSW:                   {t_hnsw*1000:8.1f} ms totales  ({t_hnsw/n_consultas*1000:.3f} ms/consulta)"
          f"   recall={recall_hnsw*100:.1f}%   aceleracion={t_bruta/t_hnsw:.1f}x")


if __name__ == "__main__":
    proc, parches, familia_de = benchmark(n_parches=20000, dim=64, n_consultas=200, k=8)
    demo_inpainting(proc, parches, familia_de, k=5)
    benchmark_hnsw(n_parches=5000, dim=64, n_consultas=200, k=8)
