import { verifyToken } from '../lib/authHash.js';

export function authRequired(role = null) {
  return (req, res, next) => {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    try {
      const decoded = verifyToken(token);
      if (role && decoded.role !== role) return res.sendStatus(403);
      req.user = decoded; // { id, role }
      next();
    } catch {
      
      console.log('🛑 Usuario no autenticado');
      res.sendStatus(401);
    }
  };
}
