const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/project/:projectId', authenticate, (req, res) => {
  const projectId = req.params.projectId;

  db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, req.userId], (err, member) => {
      if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

      db.all(`
        SELECT t.*, 
          a.name as assignee_name, a.email as assignee_email, a.avatar as assignee_avatar,
          c.name as creator_name, c.email as creator_email, c.avatar as creator_avatar
        FROM tasks t
        LEFT JOIN users a ON t.assignee_id = a.id
        JOIN users c ON t.creator_id = c.id
        WHERE t.project_id = ?
        ORDER BY t.task_order, t.created_at DESC
      `, [projectId], (err, tasks) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера.' });

        const formattedTasks = tasks.map(t => ({
          _id: t.id, title: t.title, description: t.description, project: t.project_id,
          assignee: t.assignee_id ? {
            _id: t.assignee_id, name: t.assignee_name, email: t.assignee_email, avatar: t.assignee_avatar
          } : null,
          creator: { _id: t.creator_id, name: t.creator_name, email: t.creator_email, avatar: t.creator_avatar },
          status: t.status, priority: t.priority, dueDate: t.due_date, order: t.task_order,
          createdAt: t.created_at, updatedAt: t.updated_at
        }));

        res.json({ tasks: formattedTasks });
      });
    }
  );
});

router.post('/project/:projectId', authenticate, (req, res) => {
  const projectId = req.params.projectId;
  const { title, description, assignee, priority, dueDate } = req.body;

  if (!title) return res.status(400).json({ message: 'Название задачи обязательно.' });

  db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
    [projectId, req.userId], (err, member) => {
      if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

      db.get('SELECT MAX(task_order) as maxOrder FROM tasks WHERE project_id = ?', 
        [projectId], (err, row) => {
          const newOrder = (row?.maxOrder || 0) + 1;
          const taskId = uuidv4();

          db.run(
            `INSERT INTO tasks (id, title, description, project_id, assignee_id, creator_id, priority, due_date, task_order) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [taskId, title, description || '', projectId, assignee || null, req.userId, priority || 'medium', dueDate || null, newOrder],
            function(err) {
              if (err) return res.status(500).json({ message: 'Ошибка создания задачи.' });

              res.status(201).json({
                message: 'Задача создана.',
                task: {
                  _id: taskId, title, description: description || '', project: projectId,
                  assignee: assignee ? { _id: assignee } : null,
                  creator: { _id: req.userId }, status: 'todo', priority: priority || 'medium',
                  dueDate: dueDate || null, order: newOrder
                }
              });
            }
          );
        }
      );
    }
  );
});

router.put('/:id', authenticate, (req, res) => {
  const taskId = req.params.id;
  const updates = req.body;

  db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
    if (!task) return res.status(404).json({ message: 'Задача не найдена.' });

    db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      [task.project_id, req.userId], (err, member) => {
        if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

        const fields = [];
        const values = [];

        if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
        if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
        if (updates.assignee !== undefined) { fields.push('assignee_id = ?'); values.push(updates.assignee); }
        if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
        if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
        if (updates.dueDate !== undefined) { fields.push('due_date = ?'); values.push(updates.dueDate); }
        if (updates.order !== undefined) { fields.push('task_order = ?'); values.push(updates.order); }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(taskId);

        db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values, function(err) {
          if (err) return res.status(500).json({ message: 'Ошибка обновления задачи.' });
          res.json({ message: 'Задача обновлена.', task: { _id: taskId, ...updates } });
        });
      }
    );
  });
});

router.delete('/:id', authenticate, (req, res) => {
  const taskId = req.params.id;

  db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
    if (!task) return res.status(404).json({ message: 'Задача не найдена.' });

    db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      [task.project_id, req.userId], (err, member) => {
        if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

        db.serialize(() => {
          db.run('DELETE FROM comments WHERE task_id = ?', [taskId]);
          db.run('DELETE FROM tasks WHERE id = ?', [taskId], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления задачи.' });
            res.json({ message: 'Задача удалена.' });
          });
        });
      }
    );
  });
});

router.get('/:id/comments', authenticate, (req, res) => {
  const taskId = req.params.id;

  db.all(`
    SELECT c.*, u.name as author_name, u.email as author_email, u.avatar as author_avatar
    FROM comments c
    JOIN users u ON c.author_id = u.id
    WHERE c.task_id = ?
    ORDER BY c.created_at ASC
  `, [taskId], (err, comments) => {
    if (err) return res.status(500).json({ message: 'Ошибка сервера.' });

    const formattedComments = comments.map(c => ({
      _id: c.id, text: c.text, task: c.task_id,
      author: { _id: c.author_id, name: c.author_name, email: c.author_email, avatar: c.author_avatar },
      createdAt: c.created_at
    }));

    res.json({ comments: formattedComments });
  });
});

router.post('/:id/comments', authenticate, (req, res) => {
  const taskId = req.params.id;
  const { text } = req.body;

  if (!text || text.trim() === '') return res.status(400).json({ message: 'Текст комментария обязателен.' });

  db.get('SELECT * FROM tasks WHERE id = ?', [taskId], (err, task) => {
    if (!task) return res.status(404).json({ message: 'Задача не найдена.' });

    db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
      [task.project_id, req.userId], (err, member) => {
        if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

        const commentId = uuidv4();

        db.run('INSERT INTO comments (id, text, task_id, author_id) VALUES (?, ?, ?, ?)',
          [commentId, text, taskId, req.userId], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка добавления комментария.' });

            res.status(201).json({
              message: 'Комментарий добавлен.',
              comment: { _id: commentId, text, task: taskId, author: { _id: req.userId }, createdAt: new Date().toISOString() }
            });
          }
        );
      }
    );
  });
});

module.exports = router;
