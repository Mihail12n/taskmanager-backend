const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: 'Все поля обязательны для заполнения.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Пароль должен содержать минимум 6 символов.' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
      if (existingUser) {
        return res.status(400).json({ message: 'Пользователь с таким email уже существует.' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = uuidv4();

      db.run(
        'INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)',
        [userId, email, hashedPassword, name],
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Ошибка создания пользователя.' });
          }

          const token = generateToken(userId);
          res.status(201).json({
            message: 'Пользователь успешно создан.',
            token,
            user: { id: userId, email, name, avatar: null }
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера при регистрации.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email и пароль обязательны для заполнения.' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (!user) {
        return res.status(400).json({ message: 'Неверный email или пароль.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Неверный email или пароль.' });
      }

      const token = generateToken(user.id);
      res.json({
        message: 'Вход выполнен успешно.',
        token,
        user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
      });
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера при входе.' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ 
    user: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar }
  });
});

module.exports = router;
