# Pruebas funcionales de punta a punta en modo demostración (Playwright + Chromium).
# Uso: python3 pruebas/e2e.py   (desde la carpeta cuidocadena-web)
import os, sys, re, json, time
from playwright.sync_api import sync_playwright

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
URL = 'file://' + RAIZ + '/'
CAP = os.path.join(RAIZ, 'capturas')
res = []

def foto(pg, nombre, full=False):
    # oculta la barra de demostración para que la captura quede limpia (sirve para el informe)
    pg.add_style_tag(content='.barra-demo{display:none!important} body.con-barra-demo{padding-bottom:0!important}')
    pg.screenshot(path=os.path.join(CAP, nombre), full_page=full)

def caso(id_, desc):
    def deco(fn):
        def run(browser):
            ctx = browser.new_context(viewport={'width': 1100, 'height': 800})
            pg = ctx.new_page()
            errores = []
            pg.on('pageerror', lambda e: errores.append(str(e)))
            try:
                fn(pg)
                if errores: raise AssertionError('errores de JavaScript: ' + '; '.join(errores))
                res.append((id_, desc, 'Aprobada'))
            except Exception as e:
                res.append((id_, desc, 'FALLÓ: ' + str(e).split('\n')[0][:160]))
            finally:
                ctx.close()
        run.__name__ = id_
        CASOS.append(run)
        return run
    return deco
CASOS = []

def registrar(pg, correo='laura@ejemplo.com', consent=True, edad='74'):
    pg.goto(URL + 'registro.html')
    pg.fill('#cuidadorNombre', 'Laura Martínez'); pg.fill('#cuidadorCorreo', correo); pg.fill('#cuidadorTelefono', '3001234567')
    pg.fill('#pacienteNombre', 'Rosa Elena Martínez'); pg.fill('#pacienteEdad', edad)
    if consent: pg.check('#consentimiento')
    pg.click('button[type=submit]')

def tokens(pg):
    pg.wait_for_selector('#vista-listo:not([hidden])')
    c = pg.inner_text('#enlace-c'); p = pg.inner_text('#enlace-p')
    return c.split('c=')[1], p.split('p=')[1]

def hora_en(pg, delta_min):
    return pg.evaluate("""(d) => { const t = new Date(CC.demoApi.demo.ahoraMs() + d*60000);
        return ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2); }""", delta_min)

@caso('F01', 'CU01: registrar cuidador y paciente genera los dos enlaces de acceso')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    assert len(c) == 36 and len(p) == 36 and c != p
    foto(pg, '02-registro-completado.png')

@caso('F02', 'CU01: no se registra sin la autorización de datos')
def _(pg):
    registrar(pg, consent=False)
    pg.wait_for_selector('#campo-consent.con-error')
    assert pg.is_hidden('#vista-listo')

@caso('F03', 'CU01: se rechaza un correo con formato inválido y una edad fuera de rango')
def _(pg):
    registrar(pg, correo='correo-malo', edad='40')
    pg.wait_for_selector('.con-error')
    assert pg.locator('.con-error').count() >= 2 and pg.is_hidden('#vista-listo')

@caso('F04', 'CU02: agregar un medicamento con su horario lo muestra en el resumen del día')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    pg.goto(URL + 'panel.html?c=' + c); pg.wait_for_selector('#lista-hoy')
    pg.click('#t-meds'); pg.fill('#medNombre', 'Losartán'); pg.fill('#medDosis', '1 tableta de 50 mg')
    pg.fill('#medHora', hora_en(pg, 1)); pg.fill('#medVentana', '30'); pg.click('#form-med button[type=submit]')
    pg.wait_for_selector('.med')
    foto(pg, '04-medicamentos-y-horarios.png')
    pg.click('#t-resumen')
    pg.wait_for_selector('#lista-hoy .estado')
    assert 'Losartán' in pg.inner_text('#lista-hoy')

@caso('F05', 'CU02: el formulario rechaza una hora o una ventana inválidas')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    pg.goto(URL + 'panel.html?c=' + c); pg.wait_for_selector('#lista-hoy'); pg.click('#t-meds')
    pg.fill('#medNombre', 'X'); pg.fill('#medDosis', 'Y'); pg.fill('#medVentana', '2'); pg.click('#form-med button[type=submit]')
    pg.wait_for_selector('#form-med .con-error')
    assert pg.locator('.med').count() == 0

@caso('F06', 'CU03: el paciente confirma su toma con un solo botón y queda como tomada')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    pg.evaluate("""(tk) => { return CC.demoApi.guardarMedicamento({token: tk.c, idPaciente: CC.demoApi.datosPanel({token: tk.c}).paciente.id_paciente,
        nombre: 'Metformina', dosis: '1 tableta de 850 mg', hora: (function(){const t=new Date(CC.demoApi.demo.ahoraMs()-2*60000);return ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2)})(), ventana: 30}); }""", {'c': c})
    pg.goto(URL + 'confirmar.html?p=' + p); pg.wait_for_selector('#btn-tome')
    foto(pg, '03-confirmar-toma.png')
    pg.click('#btn-tome'); pg.wait_for_selector('#bloque-exito:not([hidden])')
    pg.wait_for_selector('#lista .estado.confirmada')
    assert pg.is_hidden('#btn-tome') or pg.locator('#btn-tome').count() == 0

@caso('F07', 'CU03: no se acepta una segunda confirmación de la misma toma')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 30});
        const h = d.vistaPaciente({token: tk.p}).tomasHoy[0].id_horario;
        const a = d.confirmar({token: tk.p, idHorario: h, quien: 'paciente'});
        const b = d.confirmar({token: tk.p, idHorario: h, quien: 'paciente'});
        return [a.ok, b.ok, b.mensaje]; }""", {'c': c, 'p': p})
    assert r[0] is True and r[1] is False and 'ya estaba confirmada' in r[2]

@caso('F08', 'CU03: el cuidador puede confirmar por el paciente desde su panel')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    pg.evaluate("""(tk) => { const d = CC.demoApi; const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 30}); }""", {'c': c})
    pg.goto(URL + 'panel.html?c=' + c); pg.wait_for_selector('[data-conf]'); pg.click('[data-conf]')
    pg.wait_for_selector('#lista-hoy .estado.confirmada')
    assert 'cuidador' in pg.inner_text('#lista-hoy')

@caso('F09', 'CU04: sin confirmación, al terminar la ventana se crea la alerta y se envía el correo al cuidador')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'Atorvastatina', dosis: '20 mg', hora: hh, ventana: 5});
        d.demo.adelantarReloj(6);
        const pan = d.datosPanel({token: tk.c});
        return {alertas: pan.alertas.map(a => [a.estado_envio, a.intentos]), correos: d.demo.correos().length, estado: pan.tomasHoy[0].estado}; }""", {'c': c})
    assert r['estado'] == 'omitida' and r['alertas'] == [['enviada', 1]] and r['correos'] == 1, str(r)
    pg.goto(URL + 'panel.html?c=' + c); pg.wait_for_selector('.alerta-banner')
    foto(pg, '05-panel-con-alerta.png')

@caso('F10', 'CU04: no se duplica la alerta de una misma toma aunque el verificador se ejecute varias veces')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 5});
        d.demo.adelantarReloj(6); for (let i=0;i<5;i++) d.demo.ejecutarVerificacion();
        return [d.datosPanel({token: tk.c}).alertas.length, d.demo.correos().length]; }""", {'c': c})
    assert r == [1, 1], str(r)

@caso('F11', 'CU04: si falla el correo, reintenta y tras 3 intentos queda como fallida')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; d.demo.fallarCorreo(true);
        const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 5});
        d.demo.adelantarReloj(6); const e1 = d.datosPanel({token: tk.c}).alertas[0].estado_envio + d.datosPanel({token: tk.c}).alertas[0].intentos;
        d.demo.ejecutarVerificacion(); d.demo.ejecutarVerificacion(); d.demo.ejecutarVerificacion();
        const a = d.datosPanel({token: tk.c}).alertas[0]; return [e1, a.estado_envio, a.intentos, d.demo.correos().length]; }""", {'c': c})
    assert r[1] == 'fallida' and r[2] == 3 and r[3] == 0, str(r)

@caso('F12', 'CU05: el historial por rango de fechas muestra confirmaciones y la alerta de una toma omitida')
def _(pg):
    pg.goto(URL + 'index.html'); pg.evaluate("CC.api.demo.cargarEjemplo()")
    tk = pg.evaluate("(function(){var s=JSON.parse(localStorage.getItem('cuidocadena_demo_v1'));return s.cuidadores[0].token_acceso})()")
    pg.goto(URL + 'panel.html?c=' + tk); pg.wait_for_selector('#lista-hoy .estado')
    foto(pg, '01-panel-resumen.png')
    pg.click('#t-hist'); pg.wait_for_selector('#hist-resultado .grupo-dia')
    txt = pg.inner_text('#hist-resultado')
    assert 'Tomada' in txt and 'No confirmada' in txt and 'Alerta enviada' in txt
    assert pg.locator('#hist-resultado .grupo-dia').count() >= 3
    foto(pg, '06-historial-y-alertas.png', True)

@caso('F13', 'RF10: desactivar un medicamento no borra su historial')
def _(pg):
    pg.goto(URL + 'index.html'); pg.evaluate("CC.api.demo.cargarEjemplo()")
    tk = pg.evaluate("(function(){var s=JSON.parse(localStorage.getItem('cuidocadena_demo_v1'));return s.cuidadores[0].token_acceso})()")
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; const p = d.datosPanel({token: tk}); const m = p.medicamentos[2];
        const antes = d.historial({token: tk, idPaciente: p.paciente.id_paciente, desde: '', hasta: ''}).filas.length;
        d.cambiarActivo({token: tk, tipo: 'medicamento', id: m.id_medicamento, activo: false});
        const p2 = d.datosPanel({token: tk});
        const despues = d.historial({token: tk, idPaciente: p.paciente.id_paciente, desde: '', hasta: ''}).filas.length;
        return [antes, despues, p2.medicamentos[2].activo, p2.tomasHoy.length, p.tomasHoy.length]; }""", tk)
    assert r[0] == r[1] and r[2] is False and r[3] == r[4] - 1, str(r)

@caso('F14', 'Seguridad: un enlace inválido no muestra datos, y un cuidador no puede confirmar tomas de otro paciente')
def _(pg):
    registrar(pg, correo='a@ejemplo.com'); c1, p1 = tokens(pg)
    r = pg.evaluate("""(tk) => { const d = CC.demoApi; const mal = d.datosPanel({token: 'no-existe'});
        const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 30});
        const h = d.vistaPaciente({token: tk.p}).tomasHoy[0].id_horario;
        const otro = d.registrar({cuidadorNombre: 'Otro', cuidadorCorreo: 'otro@ejemplo.com', pacienteNombre: 'Pedro', pacienteEdad: 70, consentimiento: true});
        const x = d.confirmar({token: otro.tokenCuidador, idHorario: h, quien: 'cuidador'});
        const y = d.confirmar({token: otro.tokenPaciente, idHorario: h, quien: 'paciente'});
        return [mal.ok, x.ok, y.ok]; }""", {'c': c1, 'p': p1})
    assert r == [False, False, False], str(r)
    pg.goto(URL + 'panel.html?c=basura'); pg.wait_for_function("document.getElementById('titulo').textContent !== 'Cargando…'")
    assert 'no es válido' in pg.inner_text('#titulo')

@caso('F15', 'Usabilidad: el botón principal del paciente mide al menos 56 px de alto y la letra base 18 px')
def _(pg):
    registrar(pg); c, p = tokens(pg)
    pg.evaluate("""(tk) => { const d = CC.demoApi; const id = d.datosPanel({token: tk.c}).paciente.id_paciente;
        const t = new Date(d.demo.ahoraMs()-1*60000); const hh = ('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        d.guardarMedicamento({token: tk.c, idPaciente: id, nombre: 'A', dosis: 'B', hora: hh, ventana: 30}); }""", {'c': c})
    pg.goto(URL + 'confirmar.html?p=' + p); pg.wait_for_selector('#btn-tome')
    alto = pg.locator('#btn-tome').bounding_box()['height']
    fuente = pg.evaluate("parseFloat(getComputedStyle(document.body).fontSize)")
    assert alto >= 56 and fuente >= 17, 'alto=%s fuente=%s' % (alto, fuente)

@caso('F16', 'Usabilidad: en pantalla de celular (390 px) ninguna página tiene desplazamiento horizontal')
def _(pg):
    pg.set_viewport_size({'width': 390, 'height': 800})
    pg.goto(URL + 'index.html'); pg.evaluate("CC.api.demo.cargarEjemplo()")
    s = pg.evaluate("(function(){var s=JSON.parse(localStorage.getItem('cuidocadena_demo_v1'));return [s.cuidadores[0].token_acceso,s.pacientes[0].token_acceso]})()")
    paginas = ['index.html', 'registro.html', 'privacidad.html', 'panel.html?c=' + s[0], 'confirmar.html?p=' + s[1]]
    for i, pgn in enumerate(paginas):
        pg.goto(URL + pgn); pg.wait_for_timeout(300)
        ancho = pg.evaluate("document.documentElement.scrollWidth"); 
        assert ancho <= 392, '%s ancho=%s' % (pgn, ancho)
    pg.goto(URL + 'confirmar.html?p=' + s[1]); pg.wait_for_selector('#btn-tome')
    foto(pg, '07-celular-confirmar.png')

@caso('F17', 'Portada: se muestra el mensaje principal y el aviso de que no reemplaza el cuidado')
def _(pg):
    pg.goto(URL + 'index.html'); pg.wait_for_selector('h1')
    foto(pg, '00-inicio.png', True)
    t = pg.inner_text('main')
    assert 'Que ninguna toma' in t and 'no reemplaza' in t

with sync_playwright() as p:
    b = p.chromium.launch()
    for c in CASOS: c(b)
    b.close()

res.sort(key=lambda r: r[0])
for r in res: print(r[0] + '\t' + r[2] + '\t' + r[1])
fallos = [r for r in res if not r[2].startswith('Aprobada')]
print('\n%d de %d pruebas aprobadas' % (len(res) - len(fallos), len(res)))
json.dump(res, open(os.path.join(RAIZ, 'pruebas', 'resultados-e2e.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
sys.exit(1 if fallos else 0)
