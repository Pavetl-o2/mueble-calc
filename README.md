# Despiece — del shop drawing al costo

Sube un plano (DXF o imagen), obtén un modelo paramétrico, y de ahí la lista de
corte, los herrajes y el costo del mueble. Corre entero en el navegador y se
despliega en Vercel sin backend.

---

## Subir a GitHub y desplegar en Vercel

**1. Crea el repositorio.** En GitHub: `New` → nombre `mueble-calc` → `Create repository`.

**2. Sube los archivos.** En el repo vacío, `uploading an existing file`, arrastra
todo el **contenido** de esta carpeta (no la carpeta) y `Commit changes`.
`.gitignore` ya excluye `node_modules` y `.next`.

**3. Despliega.** En [vercel.com](https://vercel.com), inicia sesión con GitHub →
`Add New` → `Project` → elige `mueble-calc` → `Deploy`. Vercel detecta Next.js solo.

**4. (Opcional) Lectura de imágenes.** En Vercel: `Settings` → `Environment Variables`
→ agrega la llave del proveedor y vuelve a desplegar. **La lectura de DXF no lo
necesita**: se procesa en tu navegador.

| Variable | Para qué |
|---|---|
| `OPENROUTER_API_KEY` | Llave de OpenRouter. Si está, tiene prioridad. |
| `OPENROUTER_MODEL` | Modelo, p. ej. `moonshotai/kimi-k3`. **Debe aceptar imágenes.** |
| `OPENROUTER_SITE_URL` | Opcional, para atribuir el tráfico a tu app. |
| `OPENROUTER_MAX_TOKENS` | Opcional, por defecto 4000. Súbelo si el modelo devuelve respuestas vacías. |
| `ANTHROPIC_API_KEY` | Alternativa: API de Claude directo. |
| `ANTHROPIC_MODEL` | Opcional, por defecto `claude-sonnet-5`. |

Las dos rutas que usan modelo (`/api/extract-plan` y `/api/cnc-armado`) mandan una
imagen, así que un modelo de solo texto va a fallar. Si pasa, la app lo dice con
ese mensaje en vez del error crudo del proveedor.

### En local

```bash
npm install
npm run dev       # http://localhost:3000
npm run verify    # geometría, costeo, DXF y rangos extremos
npm run alzados   # dibuja alzados de todos los presets en /tmp/e2.svg
npm run build
```

---

## Por qué no se usa un kernel de CAD

Vale la pena decirlo claro porque ahorra semanas: **OpenCascade.js no ayuda en este
problema.** Es un kernel B-rep — hace booleanos, redondeos, STEP. Interpretar un shop
drawing es un problema de *lectura y mapeo*, no de modelado. Además, OCCT de código
abierto ni siquiera importa DXF (eso vive en sus componentes comerciales de
intercambio de datos). Cargarías ~40 MB de WASM sin acercarte un paso.

Lo que sí resuelve el problema es un **parser de DXF** (`dxf-parser`, unos pocos KB)
más lógica de interpretación. Y para la geometría: en mobiliario de tablero el 95% de
las piezas son prismas rectangulares, que Three.js dibuja de forma nativa.

El kernel se vuelve necesario el día que necesites patas cónicas, molduras, o exportar
STEP. Para entonces se cuelga como servicio aparte (build123d es la mejor opción) sin
tocar el motor: la lista de piezas ya es la fuente de verdad.

---

## Cómo funciona la importación

**DXF (recomendado).** Un shop drawing en DXF trae las medidas exactas. El lector saca:

1. **Cotas** (entidades `DIMENSION`) — el valor medido real. Es lo más confiable.
2. **Textos** — leyendas de material, nombres de vista, y medidas escritas como
   "0.50 m" o "500 mm".
3. **Vistas** — grupos de geometría separados en el espacio (planta, alzados), por
   agrupación espacial. Solo se usan como respaldo cuando no hay cotas.

Cada medida se muestra con su origen, y tú asignas cuál es el ancho, el alto y la
profundidad. Las cotas medidas siempre le ganan a las estimaciones de vista.

**Imagen.** Para cuando solo hay una foto o un PDF exportado. Un modelo de visión
propone la envolvente; hay que verificarla. Menos preciso que el DXF por definición.

En ambos casos el plano da **la envolvente**, no la construcción interior. Si el
cuerpo lleva puertas o cajones, con qué espesor, con qué holguras — eso es método
constructivo, y casi ningún dibujo lo especifica. Se define en la pestaña Estructura.

---

## El modelo de datos

Un solo `FurnitureSpec` describe la mayoría del mobiliario de tablero:

- **Envolvente**: ancho, alto total, profundidad.
- **Base**: zoclo, patas o ninguna.
- **Cubierta**: ninguna, integrada, o sobrepuesta (piedra) con entrecalle opcional.
- **División interna**: el cuerpo es una rejilla de **columnas**, y cada columna se
  apila en **celdas**. Cada celda elige su frente: 2 puertas, 1 puerta, cajón o
  abierto, más repisas. Las proporciones reparten el espacio disponible.

Con eso se arman gabinetes, alacenas, torres, cajoneras, buroes y credenzas — y la
lectura de planos solo tiene que llenar esta estructura.

```
lib/
  spec.ts        FurnitureSpec + presets
  build.ts       MÉTODO CONSTRUCTIVO: spec -> piezas + herrajes + geometría
  dxf.ts         Lector de shop drawings en DXF
  costing.ts     Motor de costeo y agrupador de lista de corte
  exporters.ts   CSV, manifiesto JSON y DXF por pieza
  catalog.ts     Precios de ejemplo
  types.ts       Contrato de datos
```

### Convención de ejes

- `X` = ancho, `Y` = profundidad, `Z` = alto. Todo en milímetros.
- `px, py, pz` es la **esquina mínima** de la pieza, no su centro.
- `y = 0` es el **frente**. Los frentes ocupan `y = 0` a `y = espesor`, y el cuerpo
  arranca detrás de ellos: por eso la profundidad declarada ya los incluye.
- Un voladizo de cubierta sí sobresale de la envolvente, a propósito.

### Dónde vive tu método constructivo

En `lib/build.ts`. Ahí están las reglas: piso y techo entre costados, fondo ranurado
10 mm adentro, holguras de frente, descuento por el par de correderas, bisagras según
altura de puerta, pernos por repisa. Cambiar una línea cambia el despiece de **todos**
los muebles. Eso es tu método capturado en un solo lugar.

---

## Costeo

- **Tablero**: área neta ÷ factor de aprovechamiento → m² reales → hojas → precio.
  Ese factor es el número a calibrar contra el consumo real de tu nesting.
- **Canto**: metros lineales de las aristas marcadas × precio/ml.
- **Herrajes**: derivados de las reglas, no capturados a mano.
- **Acabados**: m² de superficie tratada × precio/m².
- **Mano de obra**: por pieza cortada, por ml de canto, por módulo, por herraje.
- **Overhead y margen**: porcentajes sobre el costo directo.

Las **rutas** separan lo que va al CNC de lo que se compra o se subcontrata. Una
cubierta de piedra nunca pisa el router: sale como línea de compra con sus medidas.

El catálogo se guarda en tu navegador. Para producción conviene moverlo a una base de
datos y **congelar una copia de la lista de precios dentro de cada cotización emitida**,
para poder reproducirla meses después.

---

## Exportaciones

| Archivo | Para qué |
|---|---|
| Lista de corte CSV | Taller, compras, Excel |
| Costos CSV | Cotización y análisis |
| Manifiesto JSON | Integración con ERP o nesting |
| Piezas DXF | Una polilínea cerrada por pieza, cada una en su capa |

---

## Límites conocidos

- Todas las piezas son prismas rectangulares. No hay patas cónicas, molduras ni curvas.
- El DXF de salida trae el contorno, no el barrenado. Las operaciones van anotadas por
  pieza (`maquinado`) para que el CAM las aplique por regla.
- La detección de vistas en el DXF de entrada es aproximada: sirve de respaldo cuando
  el dibujo no trae cotas. Con cotas, las medidas son exactas.
- Los precios del catálogo son de ejemplo. Sustitúyelos antes de cotizar.
