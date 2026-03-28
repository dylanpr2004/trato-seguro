const API_URL = 'http://localhost:3000';
 
// Verificar si el token expiró
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
        // Servidor no disponible, no cerrar sesión
        console.log('Servidor no disponible:', error.message);
    }
}
 
verificarToken();