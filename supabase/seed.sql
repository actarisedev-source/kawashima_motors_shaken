insert into tenants (name, slug)
values ('川島モータース', 'kawashima-motors')
on conflict (slug) do nothing;

