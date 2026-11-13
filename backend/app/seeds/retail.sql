CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL
);
CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0)
);
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL CHECK (status IN ('paid', 'cancelled', 'pending')),
    ordered_on TEXT NOT NULL
);
INSERT INTO customers VALUES
    (1, '林澄', '福州'), (2, '陈禾', '厦门'), (3, '周遥', '泉州'),
    (4, '许青', '福州'), (5, '叶宁', '厦门');
INSERT INTO products VALUES
    (1, '笔记本', 1900), (2, '钢笔', 3800), (3, '文件夹', 1200), (4, '便签', 600);
INSERT INTO orders VALUES
    (1, 1, 1, 2, 'paid', '2026-01-01'),
    (2, 1, 2, 1, 'paid', '2026-01-04'),
    (3, 1, 3, 2, 'cancelled', '2026-01-05'),
    (4, 2, 4, 3, 'paid', '2026-01-06'),
    (5, 2, 1, 1, 'pending', '2026-01-07'),
    (6, 3, 3, 4, 'paid', '2026-01-08'),
    (7, 4, 2, 1, 'cancelled', '2026-01-09');
