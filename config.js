const API_URL = 'https://shop-seguro.onrender.com';

async function verificarToken() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const respuesta = await fetch(`${API_URL}/api/perfil`, {
            headers: { 'authorization': token }
        });
        if (respuesta.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('usuario');
            localStorage.removeItem('email');
            alert('Tu sesión expiró. Por favor inicia sesión nuevamente.');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.log('Servidor no disponible:', error.message);
    }
}
verificarToken();