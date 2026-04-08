const jwt = require('jsonwebtoken');
const db = require('../database');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'Доступ запрещен. Требуется авторизация.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    db.get('SELECT * FROM users WHERE id = ?', [decoded.userId], (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Пользователь не найден.' });
      }
      req.user = user;
      req.userId = user.id;
      next();
    });
  } catch (error) {
    res.status(401).json({ message: 'Недействительный токен.' });
  }
};

const authorizeProjectAccess = async (req, res, next) => {
  try {
    const projectId = req.params.id || req.params.projectId;
    
    db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', 
      [projectId, req.userId], 
      (err, member) => {
        if (err || !member) {
          return res.status(403).json({ message: 'Доступ запрещен.' });
        }
        next();
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера.' });
  }
};

module.exports = { authenticate, authorizeProjectAccess };
