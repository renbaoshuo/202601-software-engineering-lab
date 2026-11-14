import sqlite3
from contextlib import closing
from pathlib import Path

from .contracts import Column, Dataset, DatasetSchema, ForeignKey, Table
from .sqlite_runner import load_seed

DATASET_VERSION = "1"
SEEDS = Path(__file__).with_name("seeds")
DATASETS = {
    "retail": Dataset(
        id="retail",
        name="零售订单",
        description="通过客户、商品和订单学习连接与分组。",
        sample_goal="统计每位客户的已支付订单数，包括没有已支付订单的客户。",
        sample_sql=(
            "SELECT c.name, COUNT(o.id) AS paid_orders\n"
            "FROM customers AS c\n"
            "LEFT JOIN orders AS o ON o.customer_id = c.id AND o.status = 'paid'\n"
            "GROUP BY c.id, c.name\n"
            "ORDER BY c.id;"
        ),
    ),
    "library": Dataset(
        id="library",
        name="图书借阅",
        description="通过书目和借阅记录练习过滤与 NULL。",
        sample_goal="列出尚未归还的借阅记录。",
        sample_sql=(
            "SELECT b.title, l.borrower, l.borrowed_on\n"
            "FROM loans AS l JOIN books AS b ON b.id = l.book_id\n"
            "WHERE l.returned_on IS NULL\n"
            "ORDER BY l.id;"
        ),
    ),
}


def seed_sql(dataset_id: str) -> str:
    dataset = DATASETS[dataset_id]
    return (SEEDS / f"{dataset.id}.sql").read_text(encoding="utf-8")


def dataset_schema(dataset_id: str) -> DatasetSchema:
    with closing(sqlite3.connect(":memory:")) as connection:
        load_seed(connection, seed_sql(dataset_id))
        table_names = connection.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"
        )
        tables = []
        for (name,) in table_names:
            columns = connection.execute(
                'SELECT name, type, "notnull", pk FROM pragma_table_info(?) ORDER BY cid',
                (name,),
            )
            foreign_keys = connection.execute(
                'SELECT "from", "table", "to" FROM pragma_foreign_key_list(?) ORDER BY id, seq',
                (name,),
            )
            tables.append(Table(
                name=name,
                columns=[
                    Column(
                        name=column, type=kind,
                        nullable=not required and not (key and kind.upper() == "INTEGER"),
                        primary_key=key,
                    )
                    for column, kind, required, key in columns
                ],
                foreign_keys=[
                    ForeignKey(column=column, table=table, target=target)
                    for column, table, target in foreign_keys
                ],
            ))
    return DatasetSchema(dataset=DATASETS[dataset_id], tables=tables)
