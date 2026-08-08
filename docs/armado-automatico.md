# Armado automatico: decisiones

Hoja de ruta para que un DXF de corte se arme solo, sin parametros ni foto.
Se va llenando decision por decision.

## Contexto

El detector de juntas ya lee archivos de CAM reales (juntas con alivio de
fresa, espesor declarado en capa, layouts repetidos, varias hojas). Con eso
la estanteria Linnea pasa de 0 a 29 juntas y 14 uniones.

Lo que queda no es leer mejor: es **elegir** bien. El solver crece de forma
codiciosa y se queda con el primer armado consistente, que no siempre es el
correcto. En Linnea cruza los entrepanos entre si como una rejilla —
geometricamente valido, y equivocado.

## Decisiones tomadas

### 1. Como se elige entre varios armados consistentes

**Busqueda global con puntaje.** El solver produce varios candidatos y los
puntua; gana el mejor, no el primero. La foto de referencia, si la hay, entra
como un termino mas del puntaje, no como fuente de verdad.

Motivo: con todas las piezas presentes el armado correcto ya es derivable de
la geometria — la rejilla se delata sola porque deja montantes sin colocar.
Es un problema de busqueda, no de informacion. Y mejora los cuatro archivos
de prueba, no solo el que fallaba.

Descartadas: la foto fijando roles y plomo (senal debil: hoy el modelo lee
los entrepanos de 1100x380 como montantes verticales); la foto verificando
siluetas al final (util, pero encima de esto); y renunciar a la foto por
completo.

### 2. Que forma tiene la busqueda

**Beam search:** se mantienen las k mejores armaduras parciales en cada paso
en vez de una sola.

Motivo: el fallo es compromiso temprano. En Linnea la mala eleccion cae en la
SEGUNDA colocacion -desde c17, que solo tiene ranuras de 12 mm, lo unico
posible es una media madera-, asi que reintentar desde otra semilla es suerte,
no robustez. El beam conserva viva la alternativa justo donde importa.

Costo: el armado corre en el navegador, sin red. Hoy tarda 1 ms (silla), 9 ms
(mesa), 17 ms (linnea) y 530 ms (banco, 33 piezas). Con k=8 el peor caso queda
en unos 4 s, acotado por construccion. Por eso se descarto el backtracking
completo: no cuesta k veces mas sino que puede explotar, y el banco tiene 116
cajas que encajan todas con todas.

El multi-arranque es el caso k=1 del mismo codigo, asi que sirve de primer
incremento sin tirar nada.
