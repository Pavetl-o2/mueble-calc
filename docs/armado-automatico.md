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
