"""Plantilla de verificar.py — copiala a la raíz de cada proyecto y adaptala.

Contrato: `python verificar.py` sale 0 si está todo bien, 1 si algo falló.
Eso es todo. Un agente necesita UN comando que le conteste si rompió algo; si
no lo tiene, o no verifica, o se inventa cómo.

Ponelo en el CLAUDE.md del proyecto para que se encuentre solo.
"""
import os
import subprocess
import sys
import glob

BASE = os.path.dirname(os.path.abspath(__file__))
fallas = []


def chequear(nombre, funcion):
    try:
        problema = funcion()
    except Exception as e:                      # noqa: BLE001
        problema = "%s: %s" % (type(e).__name__, e)
    if problema:
        fallas.append("%s — %s" % (nombre, problema))
        print("FALLA  %s: %s" % (nombre, problema))
    else:
        print("ok     %s" % nombre)


# ------------------------------------------------------ chequeos genéricos

def sintaxis():
    """Que todo el Python del proyecto al menos compile."""
    import py_compile
    rotos = []
    for ruta in glob.glob(os.path.join(BASE, "**", "*.py"), recursive=True):
        if any(x in ruta for x in ("__pycache__", ".venv", "node_modules")):
            continue
        try:
            py_compile.compile(ruta, doraise=True)
        except py_compile.PyCompileError as e:
            rotos.append(os.path.relpath(ruta, BASE) + ": " + str(e).split("\n")[0])
    return "; ".join(rotos[:5]) if rotos else None


def tests():
    """Corre los test_*.py que ya existan. OJO: fijate si el proyecto ya los
    tiene antes de escribir tests nuevos — suelen estar y nadie los corre."""
    archivos = sorted(glob.glob(os.path.join(BASE, "test_*.py")))
    if not archivos:
        return None                              # no hay: no es una falla
    rotos = []
    for archivo in archivos:
        p = subprocess.run([sys.executable, archivo], capture_output=True,
                           text=True, timeout=300, cwd=BASE)
        if p.returncode != 0:
            rotos.append(os.path.basename(archivo))
    return "fallaron: " + ", ".join(rotos) if rotos else None


def secretos_fuera_del_ignore():
    """Que ninguna credencial ni base de datos esté por entrar a git."""
    if not os.path.isdir(os.path.join(BASE, ".git")):
        return None
    p = subprocess.run(["git", "-C", BASE, "ls-files", "--cached", "--others",
                        "--exclude-standard"], capture_output=True, text=True)
    permitidos = {"ejemplo-recupero.csv"}        # datos inventados, plantilla de carga
    riesgo = [l for l in p.stdout.splitlines()
              if l not in permitidos and (
                  os.path.basename(l).lower() in
                  (".env", ".secrets", ".api_key", "credentials.json")
                  or l.lower().endswith((".db", ".db-wal", ".db-shm", ".pem", ".key",
                                         ".xlsx", ".csv")))]
    return "quedarían en el repo: " + ", ".join(riesgo[:5]) if riesgo else None


# --------------------------------------------- chequeos propios del proyecto
# Agregá acá lo que sea específico: que el server levante, que la DB tenga las
# tablas esperadas, que un import clave no explote, que un cálculo dé bien.
#
import re

HT = os.path.join(BASE, "htdocs")


def _leer(rel):
    with open(os.path.join(HT, rel), encoding="utf-8", errors="replace") as f:
        return f.read()


def candado_neotel():
    """neotel_guard.php es lo único que protege la DB del telefónico."""
    src = _leer("neotel_guard.php")
    falta = [x for x in ("function assertSoloLectura", "function consultar")
             if x not in src]
    return "falta en neotel_guard.php: %s" % falta if falta else None


def sin_secretos_en_codigo():
    """Claves reales viven en ../secrets.local.php, nunca en htdocs.
    (La apiKey web de Firebase es pública por diseño y no cuenta.)"""
    patron = re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}|sk-proj-[A-Za-z0-9_-]{10,}"
                        r"|BEGIN (RSA )?PRIVATE KEY")
    hallados = []
    for ruta in glob.glob(os.path.join(HT, "**", "*.*"), recursive=True):
        if ruta.endswith((".php", ".html", ".jsx", ".js", ".htaccess", ".sh", ".bat")):
            with open(ruta, encoding="utf-8", errors="replace") as f:
                if patron.search(f.read()):
                    hallados.append(os.path.relpath(ruta, BASE))
    return "posibles claves en: %s" % hallados if hallados else None


TOKENS_FILTRADOS = ("dasa-neotel-9f3k2p7x-2026", "dasa-audio-2026-seguro")
# Endpoints web: todos deben pasar por cyc_requerir() (ver htdocs/cyc_auth.php).
ENDPOINTS = ("neotel_sql.php", "analizar.php", "transcribir.php", "upload.php", "audio.php",
             "whatsapp.php", "create_user.php", "v2/api/_lib.php")
ENDPOINTS_SUPER = ("upload.php", "whatsapp.php", "create_user.php")


def endpoints_con_sesion():
    """Que ningún endpoint quede abierto (antes whatsapp.php no pedía nada)."""
    malos = []
    for rel in ENDPOINTS:
        src = _leer(rel)
        nivel = "'super'" if rel in ENDPOINTS_SUPER else "'usuario'"
        if "cyc_requerir(%s)" % nivel not in src:
            malos.append(rel)
    return "sin cyc_requerir del nivel correcto: %s" % malos if malos else None


def sin_tokens_filtrados():
    """Los tokens viejos estuvieron en el JS público: no pueden volver al código."""
    hallados = []
    for ruta in glob.glob(os.path.join(HT, "**", "*.*"), recursive=True):
        if ruta.endswith((".php", ".html", ".jsx", ".js")):
            with open(ruta, encoding="utf-8", errors="replace") as f:
                s = f.read()
            if any(t in s for t in TOKENS_FILTRADOS):
                hallados.append(os.path.relpath(ruta, BASE))
    return "token viejo en: %s" % hallados if hallados else None


def php_tests():
    """tests/test_cyc_auth.php si hay PHP en el PATH (en el server siempre hay)."""
    import shutil
    php = shutil.which("php") or os.environ.get("PHP_BIN")
    if not php:
        print("       (sin php en el PATH: se saltean los tests de PHP)")
        return None
    for test in sorted(glob.glob(os.path.join(BASE, "tests", "test_*.php"))):
        p = subprocess.run([php, test], capture_output=True, text=True, timeout=120, cwd=BASE)
        if p.returncode != 0:
            return os.path.basename(test) + ": " + (p.stdout + p.stderr)[-600:]
    return None


def v2_referencias():
    """Que todo js/css que pide v2/index.html exista."""
    src = _leer(os.path.join("v2", "index.html"))
    refs = re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', src)
    faltan = [r for r in refs if not os.path.isfile(os.path.join(HT, "v2", r))]
    if not refs:
        return "v2/index.html no referencia ningún js/css"
    return "faltan: %s" % faltan if faltan else None


def llaves_balanceadas():
    """Chequeo grueso de JSX/JS: llaves, paréntesis y corchetes balanceados."""
    rotos = []
    for ruta in glob.glob(os.path.join(HT, "v2", "js", "*.jsx")):
        with open(ruta, encoding="utf-8") as f:
            s = f.read()
        for a, b in ("{}", "()", "[]"):
            if s.count(a) != s.count(b):
                rotos.append("%s %s%s" % (os.path.basename(ruta), a, b))
    return "; ".join(rotos) if rotos else None


def main():
    chequear("sintaxis python", sintaxis)
    chequear("tests", tests)
    chequear("secretos fuera del .gitignore", secretos_fuera_del_ignore)
    chequear("candado neotel", candado_neotel)
    chequear("endpoints con sesión", endpoints_con_sesion)
    chequear("sin tokens filtrados", sin_tokens_filtrados)
    chequear("tests PHP (tests/test_*.php)", php_tests)
    chequear("sin secretos en htdocs", sin_secretos_en_codigo)
    chequear("v2: archivos referenciados", v2_referencias)
    chequear("v2: llaves balanceadas", llaves_balanceadas)

    print()
    if fallas:
        print("%d falla(s)." % len(fallas))
        return 1
    print("Todo bien.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
