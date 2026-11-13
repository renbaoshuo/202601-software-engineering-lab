CREATE TABLE books (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL
);
CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id),
    borrower TEXT NOT NULL,
    borrowed_on TEXT NOT NULL,
    returned_on TEXT
);
INSERT INTO books VALUES
    (1, '数据库入门', '计算机'), (2, '茶与山川', '人文'),
    (3, 'SQL 练习册', '计算机'), (4, '城市漫步', '人文');
INSERT INTO loans VALUES
    (1, 1, '余文', '2026-01-03', '2026-01-10'),
    (2, 1, '何云', '2026-01-11', NULL),
    (3, 2, '余文', '2026-01-10', NULL),
    (4, 3, '林城', '2026-01-05', '2026-01-09'),
    (5, 3, '何云', '2026-01-06', '2026-01-09');
