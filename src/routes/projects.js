const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const query = `
    SELECT p.*, u.name as owner_name, u.email as owner_email
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    JOIN users u ON p.owner_id = u.id
    WHERE pm.user_id = ?
    ORDER BY p.updated_at DESC
  `;
  
  db.all(query, [req.userId], (err, projects) => {
    if (err) return res.status(500).json({ message: 'Ошибка сервера.' });

    const projectIds = projects.map(p => p.id);
    if (projectIds.length === 0) return res.json({ projects: [] });

    const membersQuery = `
      SELECT pm.project_id, pm.role, u.id, u.name, u.email, u.avatar
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id IN (${projectIds.map(() => '?').join(',')})
    `;

    db.all(membersQuery, projectIds, (err, members) => {
      const projectsWithMembers = projects.map(p => ({
        _id: p.id,
        name: p.name,
        description: p.description,
        owner: { _id: p.owner_id, name: p.owner_name, email: p.owner_email },
        members: members.filter(m => m.project_id === p.id).map(m => ({
          user: { _id: m.id, name: m.name, email: m.email, avatar: m.avatar },
          role: m.role
        })),
        startDate: p.start_date,
        endDate: p.end_date,
        status: p.status,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }));

      res.json({ projects: projectsWithMembers });
    });
  });
});

router.post('/', authenticate, (req, res) => {
  const { name, description, endDate } = req.body;
  if (!name) return res.status(400).json({ message: 'Название проекта обязательно.' });

  const projectId = uuidv4();
  const memberId = uuidv4();

  db.serialize(() => {
    db.run(
      'INSERT INTO projects (id, name, description, owner_id, end_date) VALUES (?, ?, ?, ?, ?)',
      [projectId, name, description || '', req.userId, endDate || null]
    );

    db.run(
      'INSERT INTO project_members (id, project_id, user_id, role) VALUES (?, ?, ?, ?)',
      [memberId, projectId, req.userId, 'owner'],
      function(err) {
        if (err) return res.status(500).json({ message: 'Ошибка создания проекта.' });

        res.status(201).json({
          message: 'Проект создан.',
          project: {
            _id: projectId, name, description: description || '',
            owner: { _id: req.userId },
            members: [{ user: { _id: req.userId }, role: 'owner' }],
            status: 'active'
          }
        });
      }
    );
  });
});

router.get('/:id', authenticate, (req, res) => {
  const projectId = req.params.id;

  db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, project) => {
    if (!project) return res.status(404).json({ message: 'Проект не найден.' });

    db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', 
      [projectId, req.userId], (err, member) => {
        if (!member) return res.status(403).json({ message: 'Доступ запрещен.' });

        db.all(`
          SELECT pm.role, u.id, u.name, u.email, u.avatar
          FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ?
        `, [projectId], (err, members) => {
          res.json({
            project: {
              _id: project.id, name: project.name, description: project.description,
              owner: { _id: project.owner_id },
              members: members.map(m => ({
                user: { _id: m.id, name: m.name, email: m.email, avatar: m.avatar },
                role: m.role
              })),
              startDate: project.start_date, endDate: project.end_date, status: project.status
            }
          });
        });
      }
    );
  });
});

router.delete('/:id', authenticate, (req, res) => {
  const projectId = req.params.id;

  db.get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ? AND role = ?',
    [projectId, req.userId, 'owner'], (err, member) => {
      if (!member) return res.status(403).json({ message: 'Требуются права владельца.' });

      db.serialize(() => {
        db.run('DELETE FROM comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)', [projectId]);
        db.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
        db.run('DELETE FROM project_members WHERE project_id = ?', [projectId]);
        db.run('DELETE FROM projects WHERE id = ?', [projectId], function(err) {
          if (err) return res.status(500).json({ message: 'Ошибка удаления проекта.' });
          res.json({ message: 'Проект удален.' });
        });
      });
    }
  );
});

module.exports = router;
