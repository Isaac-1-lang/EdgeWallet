## MongoDB export for EdgeWallet backend

You can export the core collections (`cards`, `transactions`, `products`) using either `mongoexport` (JSON/CSV) or `mongodump` (binary dump).

These examples assume that the `MONGODB_URI` environment variable is set to your database connection string (the same one used by the backend).

### Using mongoexport (JSON)

- **Export cards**

```bash
mongoexport --uri="$MONGODB_URI" --collection=cards --out=cards.json
```

- **Export transactions**

```bash
mongoexport --uri="$MONGODB_URI" --collection=transactions --out=transactions.json
```

- **Export products**

```bash
mongoexport --uri="$MONGODB_URI" --collection=products --out=products.json
```

### Using mongodump

Dump the full database (recommended for submissions if allowed):

```bash
mongodump --uri="$MONGODB_URI" --out=./dump
```

This will create a folder (for example `./dump`) containing BSON and metadata files for all collections, including:

- `cards`
- `transactions`
- `products`

You can compress this folder (e.g. zip) for submission.

