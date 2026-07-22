package repo

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID           uuid.UUID `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	Email        *string   `json:"email,omitempty"`
	Phone        *string   `json:"phone,omitempty"`
	CompanyName  *string   `json:"company_name,omitempty"`
	Role         string    `json:"role"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type UserRepo struct {
	pool *pgxpool.Pool
}

func NewUserRepo(pool *pgxpool.Pool) *UserRepo {
	return &UserRepo{pool: pool}
}

// Create 注册新用户（密码 bcrypt 哈希）
func (r *UserRepo) Create(ctx context.Context, username, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	u := &User{}
	err = r.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash) VALUES ($1, $2)
		 RETURNING id, username, role, status, created_at, updated_at`,
		username, string(hash),
	).Scan(&u.ID, &u.Username, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// FindByUsername 按用户名查找
func (r *UserRepo) FindByUsername(ctx context.Context, username string) (*User, error) {
	u := &User{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, username, password_hash, email, phone, company_name, role, status, created_at, updated_at
		 FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Email, &u.Phone, &u.CompanyName, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// FindByID 按 ID 查找
func (r *UserRepo) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	u := &User{}
	err := r.pool.QueryRow(ctx,
		`SELECT id, username, email, phone, company_name, role, status, created_at, updated_at
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Phone, &u.CompanyName, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// FindByCompanyName 按公司名称（大小写不敏感精确匹配）查找，可能返回多个同名公司用户
func (r *UserRepo) FindByCompanyName(ctx context.Context, name string) ([]*User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, username, email, phone, company_name, role, status, created_at, updated_at
		 FROM users WHERE LOWER(company_name) = LOWER($1)`, name,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Phone, &u.CompanyName, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

// SearchByCompanyOrUsername 按公司名称或用户名模糊搜索（ILIKE），返回最多 20 条
func (r *UserRepo) SearchByCompanyOrUsername(ctx context.Context, q string) ([]*User, error) {
	like := "%" + q + "%"
	rows, err := r.pool.Query(ctx,
		`SELECT id, username, email, phone, company_name, role, status, created_at, updated_at
		 FROM users
		 WHERE company_name ILIKE $1 OR username ILIKE $1
		 ORDER BY company_name, username
		 LIMIT 20`, like,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Phone, &u.CompanyName, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

// CheckPassword 验证密码
func (r *UserRepo) CheckPassword(ctx context.Context, username, password string) (*User, error) {
	u, err := r.FindByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return nil, err
	}
	return u, nil
}
