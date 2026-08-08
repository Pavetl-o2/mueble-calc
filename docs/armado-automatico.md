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

### 3. Que mide el puntaje

**Cobertura simple:** manda piezas colocadas, despues uniones cerradas, y
despues validez fisica (nada interpenetrado, una sola pieza rigida). Si no
alcanza, el siguiente ingrediente acordado es penalizar blandamente que dos
piezas de la misma forma queden cruzadas entre si.

Motivo: con el fileset completo la cobertura ya rechaza la rejilla, porque
dejaria los montantes altos sin colocar. Todo lo demas se agrega solo cuando
se demuestre que hace falta, no antes.

**Descartado por medicion: el aprovechamiento de juntas.** Parecia el
ingrediente que delataba la rejilla y no delata nada:

    archivo   disponibles  usadas  aprovechamiento  correcto
    mesa               20      12             60%   si
    silla              14      12             86%   si
    banco             116     116            100%   si
    linnea (rejilla)   35      28             80%   NO

La rejilla aprovecha mas juntas que el armado correcto de la mesa.

**Limite que ningun puntaje levanta:** con una sola hoja de un juego, la
rejilla es completa, rigida y bien aprovechada. No hay puntaje que la
rechace. Lo que la delata es que falten los montantes, y eso solo aparece
cargando las demas hojas. El puntaje elige bien cuando estan todas las
piezas; no suple las que no estan.

### 4. Como se valida

**Con el fileset completo de Linnea**, primero. Es el caso real que fallo, y
decide de una si la afirmacion central de la decision 3 se sostiene: que con
todas las piezas la cobertura rechaza la rejilla.

Despues, casos sinteticos con verdad conocida -generar muebles por codigo,
exportarlos a DXF y exigir que el solver recupere el original- para poder
ajustar constantes sobre un banco grande en vez de sobre cuatro archivos.
Con una salvedad anotada: un banco sintetico mide la BUSQUEDA, no el
detector, porque los alivios los genera quien ya sabe manejarlos. Para el
detector siguen haciendo falta archivos reales de fuentes distintas.

Descartada la auto-consistencia sin verdad (que el armado cierre sin huecos
ni choques): la rejilla de Linnea la aprueba.

Estado: **a la espera de las demas hojas del juego.**

### 5. Espesor cuando las hojas no coinciden

**Espesor por pieza, heredado de su hoja.** Cada pieza carga el espesor de
donde salio, cada junta se mide con el suyo, y el emparejado compara con la
tolerancia de cada lado. Un campo `espesor` en ContornoCnc y `pieza.espesor ??
global` en los tres lugares que hoy reciben el numero suelto: juntasDe,
inventarioJuntas y resolverArmado.

Motivo: es requisito de la decision 4, no una mejora opcional. Opendesk
exporta un archivo POR ESPESOR -el que tenemos se llama cad2_12.0000- asi que
cargar el juego completo cae de lleno en el caso que hoy se resuelve mal:
la fusion colapsa todo a un numero y avisa, y con dos espesores mezclados la
mitad de las juntas se mide contra el tablero equivocado.

Descartado no fusionar hojas de distinto espesor: en un flat-pack real las
piezas de 12 y las de 18 se ensamblan ENTRE SI, y separarlas garantiza que
nunca cierre.

### 6. Que se muestra cuando el candidato no es confiable

**El mejor y sus alternativos.** Si el segundo o el tercero del beam puntuan
casi igual, se muestran y elige la persona. Con el beam ya decidido sale
gratis: los candidatos estan calculados, solo hay que no tirarlos.

Motivo: el problema nunca fue equivocarse, fue equivocarse con cara de
seguro. Hoy la app dibuja la rejilla con una etiqueta chica de "confianza
baja". Ademas da una senal diagnostica que no existe: si los tres primeros
candidatos son muy distintos entre si, el archivo es ambiguo; si son casi
iguales, el armado es solido.

Despues, y encima de esto: marcar en el visor las uniones flojas -las que
salieron de medias maderas entre piezas iguales, sin espiga que las
confirme-, que es de lo que esta hecha la rejilla.

Descartado negarse cuando la confianza es baja: se niega de mas. En la hoja 2
de Linnea, los entrepanos colgados de los montantes por espigas pasantes son
correctos y utiles aunque falte el resto del juego.

### 7. Si entra la foto, y como

**Solo aporta proporciones.** Alto, ancho y fondo aproximados del mueble, y se
penaliza a los candidatos cuya envolvente no cuadre. Comparar tres numeros
contra una envolvente es mucho menos trabajo que renderizar siluetas, y ya
descarta la rejilla de Linnea (399x1204x1100 contra un mueble que la foto
muestra alto y angosto).

Mas adelante, el escalon siguiente: **ordenar los candidatos por parecido de
silueta**, renderizando cada uno desde unos pocos angulos.

Lo importante de las dos es que la foto solo REORDENA candidatos que la
geometria ya valido. No puede inventar ninguno, asi que en el peor caso elige
mal entre cosas armables; nunca puede producir la figura que salio en la
captura.

Descartado que la foto etiquete piezas -que es lo que hace hoy-: en la captura
el modelo dijo que las piezas de 1100x380 eran montantes verticales y las de
929x189 repisas horizontales. Invirtio las dos. Ese error, convertido en
restriccion del solver, es peor que no tener foto.
